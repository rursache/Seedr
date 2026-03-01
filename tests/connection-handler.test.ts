import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { ConnectionHandler, type ConnectionContext } from '../src/core/connection-handler.js';

// Use a random high port to avoid conflicts
const TEST_PORT = 0; // Let OS pick

// Known test values
const TEST_INFO_HASH = Buffer.from('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', 'hex');
const TEST_PEER_ID = Buffer.from('-qB5140-abcdefghijkl');
const UNKNOWN_HASH = Buffer.from('ffffffffffffffffffffffffffffffffffffffff', 'hex');

function buildHandshake(infoHash: Buffer, peerId?: Buffer): Buffer {
  const buf = Buffer.alloc(68);
  buf[0] = 19;
  Buffer.from('BitTorrent protocol').copy(buf, 1);
  // bytes 20-27: reserved (zeros, already 0)
  infoHash.copy(buf, 28);
  (peerId || Buffer.alloc(20)).copy(buf, 48);
  return buf;
}

function connectAndSend(port: number, data: Buffer): Promise<{ response: Buffer; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
      socket.write(data);
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      resolve({ response: Buffer.concat(chunks), closed: true });
    });
    socket.on('error', reject);
    socket.setTimeout(3000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ response: Buffer.concat(chunks), closed: false });
    });
  });
}

describe('ConnectionHandler — BT Handshake', () => {
  let handler: ConnectionHandler;
  let port: number;

  const mockContext: ConnectionContext = {
    getInfoHashes: () => new Set([TEST_INFO_HASH.toString('hex')]),
    getPeerId: (infoHash: string) => {
      if (infoHash === TEST_INFO_HASH.toString('hex')) return TEST_PEER_ID;
      return null;
    },
  };

  beforeEach(async () => {
    handler = new ConnectionHandler();
    // Use port 0 so the OS assigns an available port
    await handler.start(0);
    port = handler.port;
    handler.setContext(mockContext);
  });

  afterEach(async () => {
    await handler.stop();
  });

  it('should respond with a valid handshake for a known info_hash', async () => {
    const handshake = buildHandshake(TEST_INFO_HASH);
    const { response } = await connectAndSend(port, handshake);

    expect(response.length).toBe(68);
    expect(response[0]).toBe(19);
    expect(response.subarray(1, 20).toString()).toBe('BitTorrent protocol');
    // Reserved bytes should be zeros
    expect(response.subarray(20, 28)).toEqual(Buffer.alloc(8));
    // Info hash should match
    expect(response.subarray(28, 48)).toEqual(TEST_INFO_HASH);
    // Peer ID should match our mock
    expect(response.subarray(48, 68)).toEqual(TEST_PEER_ID);
  });

  it('should close without response for unknown info_hash', async () => {
    const handshake = buildHandshake(UNKNOWN_HASH);
    const { response, closed } = await connectAndSend(port, handshake);

    expect(response.length).toBe(0);
    expect(closed).toBe(true);
  });

  it('should close without response for invalid protocol string', async () => {
    const buf = Buffer.alloc(68);
    buf[0] = 19;
    Buffer.from('NotBitTorrentProto!!').copy(buf, 1); // Wrong protocol
    TEST_INFO_HASH.copy(buf, 28);

    const { response, closed } = await connectAndSend(port, buf);
    expect(response.length).toBe(0);
    expect(closed).toBe(true);
  });

  it('should close without response for wrong pstrlen', async () => {
    const buf = Buffer.alloc(68);
    buf[0] = 10; // Wrong length
    Buffer.from('BitTorrent protocol').copy(buf, 1);
    TEST_INFO_HASH.copy(buf, 28);

    const { response, closed } = await connectAndSend(port, buf);
    expect(response.length).toBe(0);
    expect(closed).toBe(true);
  });

  it('should close on timeout with no data', async () => {
    const result = await new Promise<{ closed: boolean }>((resolve, reject) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        // Don't send anything — wait for timeout
      });
      socket.on('end', () => resolve({ closed: true }));
      socket.on('error', reject);
      socket.setTimeout(7000); // longer than the 5s handler timeout
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ closed: false });
      });
    });

    expect(result.closed).toBe(true);
  }, 10000);

  it('should work without context set (close silently)', async () => {
    // Create a handler without context
    const handler2 = new ConnectionHandler();
    await handler2.start(0);
    const port2 = handler2.port;
    // Don't call setContext

    const handshake = buildHandshake(TEST_INFO_HASH);
    const { response, closed } = await connectAndSend(port2, handshake);

    expect(response.length).toBe(0);
    expect(closed).toBe(true);

    await handler2.stop();
  });
});
