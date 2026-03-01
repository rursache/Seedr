import { createGunzip, createInflate } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import bencode from 'bencode';
import type { AnnounceResponse, PeerInfo, RequestHeader } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('http-tracker');

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

async function decompressResponse(
  body: Buffer,
  encoding: string | null
): Promise<Buffer> {
  if (!encoding) return body;

  const chunks: Buffer[] = [];
  const readable = Readable.from(body);

  if (encoding === 'gzip') {
    const gunzip = createGunzip();
    readable.pipe(gunzip);
    for await (const chunk of gunzip) {
      chunks.push(chunk as Buffer);
    }
  } else if (encoding === 'deflate') {
    const inflate = createInflate();
    readable.pipe(inflate);
    for await (const chunk of inflate) {
      chunks.push(chunk as Buffer);
    }
  } else {
    return body;
  }

  return Buffer.concat(chunks);
}

/**
 * Perform an HTTP tracker announce.
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    headerMap[h.name] = h.value;
  }

  try {
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: headerMap,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP tracker returned status ${res.status}`);
    }

    const rawBody = Buffer.from(await res.arrayBuffer());
    const contentEncoding = res.headers.get('content-encoding');
    const body = await decompressResponse(rawBody, contentEncoding);

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
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
