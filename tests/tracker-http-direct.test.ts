import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync, deflateSync } from 'node:zlib';
import bencode from 'bencode';
import { httpAnnounce } from '../src/core/tracker/http-tracker.js';

function compactPeers(peers: Array<{ ip: [number, number, number, number]; port: number }>): Buffer {
  const buf = Buffer.alloc(peers.length * 6);
  peers.forEach((peer, index) => {
    const offset = index * 6;
    buf[offset] = peer.ip[0];
    buf[offset + 1] = peer.ip[1];
    buf[offset + 2] = peer.ip[2];
    buf[offset + 3] = peer.ip[3];
    buf.writeUInt16BE(peer.port, offset + 4);
  });
  return buf;
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = await new Promise<Server>((resolve) => {
    const instance = createServer(handler);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not resolve server address');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('httpAnnounce', () => {
  const headers = [{ name: 'User-Agent', value: 'SeedrTest/1.0' }];

  beforeEach(() => {
    // no-op
  });

  afterEach(() => {
    // no-op
  });

  it('follows redirects and preserves custom headers', async () => {
    await withServer((req, res) => {
      if (req.url?.startsWith('/redirect')) {
        res.statusCode = 302;
        res.setHeader('Location', '/final');
        res.end();
        return;
      }

      expect(req.headers['user-agent']).toBe('SeedrTest/1.0');
      res.setHeader('Content-Type', 'text/plain');
      res.end(bencode.encode({
        interval: 1800,
        complete: 10,
        incomplete: 2,
        peers: compactPeers([{ ip: [127, 0, 0, 1], port: 6881 }]),
      }));
    }, async (baseUrl) => {
      const result = await httpAnnounce(`${baseUrl}/redirect`, 'a=1', headers);
      expect(result.seeders).toBe(10);
      expect(result.leechers).toBe(2);
      expect(result.peers).toEqual([{ ip: '127.0.0.1', port: 6881 }]);
    });
  });

  it('parses gzip-compressed responses with compact peers', async () => {
    await withServer((_req, res) => {
      const payload = bencode.encode({
        interval: 900,
        complete: 4,
        incomplete: 1,
        peers: compactPeers([{ ip: [10, 0, 0, 1], port: 51413 }]),
        'warning message': Buffer.from('careful'),
      });

      res.setHeader('Content-Encoding', 'gzip');
      res.end(gzipSync(payload));
    }, async (baseUrl) => {
      const result = await httpAnnounce(`${baseUrl}/announce`, 'a=1', headers);
      expect(result.interval).toBe(900);
      expect(result.peers).toEqual([{ ip: '10.0.0.1', port: 51413 }]);
      expect(result.warningMessage).toBe('careful');
    });
  });

  it('parses deflate-compressed responses with dictionary peers', async () => {
    await withServer((_req, res) => {
      const payload = bencode.encode({
        interval: 1200,
        complete: 8,
        incomplete: 3,
        peers: [
          { ip: Buffer.from('192.168.1.50'), port: 6000 },
          { ip: Buffer.from('192.168.1.51'), port: 6001 },
        ],
      });

      res.setHeader('Content-Encoding', 'deflate');
      res.end(deflateSync(payload));
    }, async (baseUrl) => {
      const result = await httpAnnounce(`${baseUrl}/announce`, 'a=1', headers);
      expect(result.seeders).toBe(8);
      expect(result.leechers).toBe(3);
      expect(result.peers).toEqual([
        { ip: '192.168.1.50', port: 6000 },
        { ip: '192.168.1.51', port: 6001 },
      ]);
    });
  });

  it('returns failureReason when the tracker reports one', async () => {
    await withServer((_req, res) => {
      res.end(bencode.encode({
        'failure reason': Buffer.from('Torrent banned'),
      }));
    }, async (baseUrl) => {
      const result = await httpAnnounce(`${baseUrl}/announce`, 'a=1', headers);
      expect(result.failureReason).toBe('Torrent banned');
      expect(result.peers).toEqual([]);
    });
  });

  it('rejects non-2xx responses', async () => {
    await withServer((_req, res) => {
      res.statusCode = 503;
      res.end('unavailable');
    }, async (baseUrl) => {
      await expect(httpAnnounce(`${baseUrl}/announce`, 'a=1', headers)).rejects.toThrow('HTTP tracker returned status 503');
    });
  });
});
