import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createGunzip, createInflate } from 'node:zlib';
import bencode from 'bencode';
import type { AnnounceResponse, PeerInfo, RequestHeader } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('http-tracker');

const MAX_REDIRECTS = 3;

/**
 * Parse compact peer format: each peer is 6 bytes (4 IP + 2 port).
 */
function parseCompactPeers(data: Buffer): PeerInfo[] {
  const peers: PeerInfo[] = [];

  for (let i = 0; i + 6 <= data.length; i += 6) {
    const ip = `${data[i]}.${data[i + 1]}.${data[i + 2]}.${data[i + 3]}`;
    const port = data.readUInt16BE(i + 4);
    peers.push({ ip, port });
  }

  return peers;
}

/**
 * Parse dictionary-format peers (non-compact).
 */
function parseDictPeers(peers: Array<{ ip: Buffer; port: number }>): PeerInfo[] {
  return peers.map((p) => ({
    ip: Buffer.from(p.ip).toString('utf-8'),
    port: p.port,
  }));
}

/**
 * Perform a raw HTTP(S) request with exact header control.
 *
 * Unlike fetch(), this sends ONLY the headers we specify (plus Host which
 * is mandatory in HTTP/1.1). No default Accept, Accept-Language, etc.
 * This is critical for emulating real BitTorrent clients that don't send
 * browser-style headers.
 */
function rawRequest(
  url: string,
  headers: Record<string, string>,
  timeout: number,
  redirectCount = 0
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : httpRequest;

    const req = reqFn(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        timeout,
      },
      (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          res.resume(); // Drain the response
          rawRequest(redirectUrl, headers, timeout, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          reject(new Error(`HTTP tracker returned status ${res.statusCode}`));
          return;
        }

        // Decompress if needed
        const encoding = res.headers['content-encoding'];
        let stream: NodeJS.ReadableStream = res;
        if (encoding === 'gzip') {
          stream = res.pipe(createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(createInflate());
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Perform an HTTP tracker announce.
 *
 * Uses node:http/node:https directly instead of fetch() to ensure only
 * the exact headers from the client profile are sent. Node.js fetch adds
 * default headers that real BitTorrent clients don't send, which can
 * trigger anti-cheat detection on trackers like UNIT3D.
 */
export async function httpAnnounce(
  trackerUrl: string,
  queryString: string,
  headers: RequestHeader[],
  timeout = 30000
): Promise<AnnounceResponse> {
  const separator = trackerUrl.includes('?') ? '&' : '?';
  const fullUrl = `${trackerUrl}${separator}${queryString}`;

  logger.debug({ url: trackerUrl }, 'HTTP announce');

  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    headerMap[h.name] = h.value;
  }

  const body = await rawRequest(fullUrl, headerMap, timeout);

  const decoded = bencode.decode(body);

  // Check for failure
  if (decoded['failure reason']) {
    const reason = Buffer.from(decoded['failure reason']).toString('utf-8');
    return {
      interval: 1800,
      seeders: 0,
      leechers: 0,
      peers: [],
      failureReason: reason,
    };
  }

  const interval = (decoded.interval as number) ?? 1800;
  const minInterval = decoded['min interval'] as number | undefined;
  const complete = (decoded.complete as number) ?? 0; // seeders
  const incomplete = (decoded.incomplete as number) ?? 0; // leechers

  // Parse peers
  let peers: PeerInfo[] = [];
  if (decoded.peers) {
    if (Buffer.isBuffer(decoded.peers)) {
      peers = parseCompactPeers(decoded.peers);
    } else if (Array.isArray(decoded.peers)) {
      peers = parseDictPeers(decoded.peers as Array<{ ip: Buffer; port: number }>);
    }
  }

  // Warning message
  const warningMessage = decoded['warning message']
    ? Buffer.from(decoded['warning message']).toString('utf-8')
    : undefined;

  logger.debug(
    { interval, seeders: complete, leechers: incomplete, peerCount: peers.length },
    'HTTP announce response'
  );

  return {
    interval,
    minInterval,
    seeders: complete,
    leechers: incomplete,
    peers,
    warningMessage,
  };
}
