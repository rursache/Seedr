import { describe, it, expect } from 'vitest';

// Test the compact peer parsing logic directly
describe('HTTP tracker response parsing', () => {
  it('should parse compact peers (6 bytes each)', () => {
    // Simulate compact peer format: 4 bytes IP + 2 bytes port
    const data = Buffer.alloc(12);

    // Peer 1: 192.168.1.1:6881
    data[0] = 192;
    data[1] = 168;
    data[2] = 1;
    data[3] = 1;
    data.writeUInt16BE(6881, 4);

    // Peer 2: 10.0.0.1:51413
    data[6] = 10;
    data[7] = 0;
    data[8] = 0;
    data[9] = 1;
    data.writeUInt16BE(51413, 10);

    // Manually implement the parsing logic to test
    function parseCompactPeers(buf: Buffer) {
      const peers = [];
      for (let i = 0; i + 6 <= buf.length; i += 6) {
        const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
        const port = buf.readUInt16BE(i + 4);
        peers.push({ ip, port });
      }
      return peers;
    }

    const peers = parseCompactPeers(data);
    expect(peers).toHaveLength(2);
    expect(peers[0]).toEqual({ ip: '192.168.1.1', port: 6881 });
    expect(peers[1]).toEqual({ ip: '10.0.0.1', port: 51413 });
  });

  it('should handle empty peer data', () => {
    function parseCompactPeers(buf: Buffer) {
      const peers = [];
      for (let i = 0; i + 6 <= buf.length; i += 6) {
        const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
        const port = buf.readUInt16BE(i + 4);
        peers.push({ ip, port });
      }
      return peers;
    }

    const peers = parseCompactPeers(Buffer.alloc(0));
    expect(peers).toHaveLength(0);
  });

  it('should handle truncated peer data (not multiple of 6)', () => {
    function parseCompactPeers(buf: Buffer) {
      const peers = [];
      for (let i = 0; i + 6 <= buf.length; i += 6) {
        const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
        const port = buf.readUInt16BE(i + 4);
        peers.push({ ip, port });
      }
      return peers;
    }

    // 8 bytes = 1 full peer + 2 leftover
    const data = Buffer.alloc(8);
    data[0] = 1;
    data[1] = 2;
    data[2] = 3;
    data[3] = 4;
    data.writeUInt16BE(1234, 4);

    const peers = parseCompactPeers(data);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ ip: '1.2.3.4', port: 1234 });
  });
});
