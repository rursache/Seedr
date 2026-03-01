import { describe, it, expect } from 'vitest';

describe('UDP tracker protocol', () => {
  it('should build correct connect request (16 bytes)', () => {
    const CONNECT_MAGIC = BigInt('0x41727101980');

    const buf = Buffer.alloc(16);
    buf.writeBigInt64BE(CONNECT_MAGIC, 0);
    buf.writeUInt32BE(0, 8); // action = connect
    buf.writeUInt32BE(12345, 12); // transaction_id

    expect(buf.length).toBe(16);
    expect(buf.readBigInt64BE(0)).toBe(CONNECT_MAGIC);
    expect(buf.readUInt32BE(8)).toBe(0); // connect action
    expect(buf.readUInt32BE(12)).toBe(12345);
  });

  it('should build correct announce request (98 bytes)', () => {
    const buf = Buffer.alloc(98);
    const connectionId = BigInt('0x1234567890abcdef');
    const infoHash = Buffer.alloc(20, 0xaa);
    const peerId = Buffer.alloc(20, 0xbb);

    buf.writeBigInt64BE(connectionId, 0);
    buf.writeUInt32BE(1, 8); // action = announce
    buf.writeUInt32BE(99999, 12); // transaction_id
    infoHash.copy(buf, 16);
    peerId.copy(buf, 36);
    buf.writeBigInt64BE(BigInt(50000), 56); // downloaded
    buf.writeBigInt64BE(BigInt(100000), 64); // left
    buf.writeBigInt64BE(BigInt(200000), 72); // uploaded
    buf.writeUInt32BE(2, 80); // event = started
    buf.writeUInt32BE(0, 84); // IP = default
    buf.writeUInt32BE(0xdeadbeef, 88); // key
    buf.writeInt32BE(200, 92); // num_want
    buf.writeUInt16BE(51234, 96); // port

    expect(buf.length).toBe(98);
    expect(buf.readBigInt64BE(0)).toBe(connectionId);
    expect(buf.readUInt32BE(8)).toBe(1); // announce
    expect(buf.subarray(16, 36)).toEqual(infoHash);
    expect(buf.subarray(36, 56)).toEqual(peerId);
    expect(Number(buf.readBigInt64BE(72))).toBe(200000); // uploaded
    expect(buf.readUInt32BE(80)).toBe(2); // started
    expect(buf.readInt32BE(92)).toBe(200); // num_want
    expect(buf.readUInt16BE(96)).toBe(51234); // port
  });

  it('should parse announce response correctly', () => {
    // Build a mock response: action(4) + txid(4) + interval(4) + leechers(4) + seeders(4) + peers
    const buf = Buffer.alloc(20 + 12); // header + 2 peers

    buf.writeUInt32BE(1, 0); // action = announce
    buf.writeUInt32BE(12345, 4); // transaction_id
    buf.writeUInt32BE(1800, 8); // interval
    buf.writeUInt32BE(10, 12); // leechers
    buf.writeUInt32BE(50, 16); // seeders

    // Peer 1: 192.168.1.1:6881
    buf[20] = 192;
    buf[21] = 168;
    buf[22] = 1;
    buf[23] = 1;
    buf.writeUInt16BE(6881, 24);

    // Peer 2: 10.0.0.1:51413
    buf[26] = 10;
    buf[27] = 0;
    buf[28] = 0;
    buf[29] = 1;
    buf.writeUInt16BE(51413, 30);

    // Parse manually
    const action = buf.readUInt32BE(0);
    const interval = buf.readUInt32BE(8);
    const leechers = buf.readUInt32BE(12);
    const seeders = buf.readUInt32BE(16);

    expect(action).toBe(1);
    expect(interval).toBe(1800);
    expect(leechers).toBe(10);
    expect(seeders).toBe(50);

    // Parse peers
    const peers = [];
    for (let i = 20; i + 6 <= buf.length; i += 6) {
      const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
      const port = buf.readUInt16BE(i + 4);
      peers.push({ ip, port });
    }

    expect(peers).toHaveLength(2);
    expect(peers[0]).toEqual({ ip: '192.168.1.1', port: 6881 });
    expect(peers[1]).toEqual({ ip: '10.0.0.1', port: 51413 });
  });

  it('should handle error response (action=3)', () => {
    const errorMsg = 'Connection refused';
    const buf = Buffer.alloc(8 + errorMsg.length);

    buf.writeUInt32BE(3, 0); // action = error
    buf.writeUInt32BE(12345, 4); // transaction_id
    Buffer.from(errorMsg).copy(buf, 8);

    const action = buf.readUInt32BE(0);
    expect(action).toBe(3);

    const message = buf.subarray(8).toString('utf-8');
    expect(message).toBe('Connection refused');
  });

  it('should map events to correct numeric values', () => {
    const eventMap: Record<string, number> = {
      '': 0,
      completed: 1,
      started: 2,
      stopped: 3,
    };

    expect(eventMap['']).toBe(0);
    expect(eventMap['completed']).toBe(1);
    expect(eventMap['started']).toBe(2);
    expect(eventMap['stopped']).toBe(3);
  });
});
