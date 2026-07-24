import { randomBytes } from 'node:crypto';
import type { AnnounceResponse, AnnounceEvent, PeerInfo } from '../../config/types.js';

// BEP-15 constants
const CONNECT_MAGIC = BigInt('0x41727101980');
export const ACTION_CONNECT = 0;
export const ACTION_ANNOUNCE = 1;
const ACTION_ERROR = 3;

// Event mapping
const UDP_EVENT_MAP: Record<string, number> = {
  '': 0, // none
  completed: 1,
  started: 2,
  stopped: 3,
};

export function getHostPort(trackerUrl: string): { host: string; port: number } {
  const url = new URL(trackerUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 80,
  };
}

export function buildConnectRequest(): { buffer: Buffer; transactionId: number } {
  const buf = Buffer.alloc(16);
  buf.writeBigInt64BE(CONNECT_MAGIC, 0);
  buf.writeUInt32BE(ACTION_CONNECT, 8);
  const transactionId = randomBytes(4).readUInt32BE(0);
  buf.writeUInt32BE(transactionId, 12);
  return { buffer: buf, transactionId };
}

export function buildAnnounceRequest(
  connectionId: bigint,
  infoHash: Buffer,
  peerId: Buffer,
  downloaded: number,
  left: number,
  uploaded: number,
  event: AnnounceEvent,
  key: number,
  port: number,
  numwant: number
): { buffer: Buffer; transactionId: number } {
  const buf = Buffer.alloc(98);
  const transactionId = randomBytes(4).readUInt32BE(0);

  // Offsets per BEP-15
  buf.writeBigInt64BE(connectionId, 0); // 0-7: connection_id
  buf.writeUInt32BE(ACTION_ANNOUNCE, 8); // 8-11: action
  buf.writeUInt32BE(transactionId, 12); // 12-15: transaction_id
  infoHash.copy(buf, 16); // 16-35: info_hash
  peerId.copy(buf, 36); // 36-55: peer_id

  // 56-63: downloaded (64-bit)
  buf.writeBigInt64BE(BigInt(downloaded), 56);
  // 64-71: left (64-bit)
  buf.writeBigInt64BE(BigInt(left), 64);
  // 72-79: uploaded (64-bit)
  buf.writeBigInt64BE(BigInt(uploaded), 72);
  // 80-83: event
  buf.writeUInt32BE(UDP_EVENT_MAP[event] ?? 0, 80);
  // 84-87: IP address (0 = default)
  buf.writeUInt32BE(0, 84);
  // 88-91: key
  buf.writeUInt32BE(key, 88);
  // 92-95: num_want
  buf.writeInt32BE(numwant, 92);
  // 96-97: port
  buf.writeUInt16BE(port, 96);

  return { buffer: buf, transactionId };
}

export function parseAnnounceResponse(buf: Buffer): AnnounceResponse {
  if (buf.length < 20) {
    throw new Error('UDP announce response too short');
  }

  const action = buf.readUInt32BE(0);
  if (action === ACTION_ERROR) {
    const message = buf.subarray(8).toString('utf-8');
    return {
      interval: 1800,
      seeders: 0,
      leechers: 0,
      peers: [],
      failureReason: message,
    };
  }

  if (action !== ACTION_ANNOUNCE) {
    throw new Error(`Unexpected UDP action: ${action}`);
  }

  const interval = buf.readUInt32BE(8);
  const leechers = buf.readUInt32BE(12);
  const seeders = buf.readUInt32BE(16);

  // Parse peers (6 bytes each starting at offset 20)
  const peers: PeerInfo[] = [];
  for (let i = 20; i + 6 <= buf.length; i += 6) {
    const ip = `${buf[i]}.${buf[i + 1]}.${buf[i + 2]}.${buf[i + 3]}`;
    const port = buf.readUInt16BE(i + 4);
    peers.push({ ip, port });
  }

  return { interval, seeders, leechers, peers };
}
