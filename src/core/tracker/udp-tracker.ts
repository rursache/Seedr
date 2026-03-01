import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import type { AnnounceResponse, AnnounceEvent, PeerInfo } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('udp-tracker');

// BEP-15 constants
const CONNECT_MAGIC = BigInt('0x41727101980');
const ACTION_CONNECT = 0;
const ACTION_ANNOUNCE = 1;

// Event mapping
const UDP_EVENT_MAP: Record<string, number> = {
  '': 0, // none
  completed: 1,
  started: 2,
  stopped: 3,
};

interface ConnectionState {
  connectionId: bigint;
  timestamp: number;
}

// Cache connection IDs per tracker host (valid ~1 min)
const connectionCache = new Map<string, ConnectionState>();

function getHostPort(trackerUrl: string): { host: string; port: number } {
  const url = new URL(trackerUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 80,
  };
}

function buildConnectRequest(): { buffer: Buffer; transactionId: number } {
  const buf = Buffer.alloc(16);
  buf.writeBigInt64BE(CONNECT_MAGIC, 0);
  buf.writeUInt32BE(ACTION_CONNECT, 8);
  const transactionId = randomBytes(4).readUInt32BE(0);
  buf.writeUInt32BE(transactionId, 12);
  return { buffer: buf, transactionId };
}

function buildAnnounceRequest(
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

function parseAnnounceResponse(buf: Buffer): AnnounceResponse {
  if (buf.length < 20) {
    throw new Error('UDP announce response too short');
  }

  const action = buf.readUInt32BE(0);
  if (action === 3) {
    // Error response
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

function sendAndReceive(
  socket: dgram.Socket,
  message: Buffer,
  host: string,
  port: number,
  expectedTransactionId: number,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners('message');
      reject(new Error('UDP tracker timeout'));
    }, timeoutMs);

    socket.on('message', (msg) => {
      if (msg.length < 8) return; // Too short
      const responseTxId = msg.readUInt32BE(4);
      if (responseTxId !== expectedTransactionId) return; // Not our transaction

      clearTimeout(timer);
      socket.removeAllListeners('message');
      resolve(msg);
    });

    socket.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

/**
 * Perform a UDP tracker announce with BEP-15 protocol.
 * Handles connect handshake, announce request, and retransmission.
 */
export async function udpAnnounce(
  trackerUrl: string,
  infoHash: Buffer,
  peerId: Buffer,
  port: number,
  uploaded: number,
  downloaded: number,
  left: number,
  event: AnnounceEvent,
  key: string,
  numwant: number,
  maxRetries = 4
): Promise<AnnounceResponse> {
  const { host, port: trackerPort } = getHostPort(trackerUrl);
  const cacheKey = `${host}:${trackerPort}`;

  logger.debug({ host, port: trackerPort }, 'UDP announce');

  const socket = dgram.createSocket('udp4');

  try {
    // Check connection cache
    let connectionId: bigint;
    const cached = connectionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 55000) {
      connectionId = cached.connectionId;
    } else {
      // Connect handshake with retransmission
      let attempt = 0;
      let connected = false;

      while (attempt <= maxRetries && !connected) {
        const timeout = 15000 * Math.pow(2, attempt);
        const { buffer: connectBuf, transactionId } = buildConnectRequest();

        try {
          const response = await sendAndReceive(
            socket,
            connectBuf,
            host,
            trackerPort,
            transactionId,
            timeout
          );

          const action = response.readUInt32BE(0);
          if (action !== ACTION_CONNECT || response.length < 16) {
            throw new Error('Invalid connect response');
          }

          connectionId = response.readBigInt64BE(8);
          connectionCache.set(cacheKey, { connectionId, timestamp: Date.now() });
          connected = true;
        } catch {
          attempt++;
          if (attempt > maxRetries) {
            throw new Error(`UDP connect failed after ${maxRetries + 1} attempts`);
          }
          logger.debug({ attempt }, 'UDP connect retry');
        }
      }

      if (!connected) {
        throw new Error('UDP connect failed');
      }
    }

    // Announce request with retransmission
    const keyNum = parseInt(key, 16) || 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const timeout = 15000 * Math.pow(2, attempt);
      const { buffer: announceBuf, transactionId } = buildAnnounceRequest(
        connectionId!,
        infoHash,
        peerId,
        downloaded,
        left,
        uploaded,
        event,
        keyNum,
        port,
        numwant
      );

      try {
        const response = await sendAndReceive(
          socket,
          announceBuf,
          host,
          trackerPort,
          transactionId,
          timeout
        );

        const result = parseAnnounceResponse(response);

        logger.debug(
          { interval: result.interval, seeders: result.seeders, leechers: result.leechers },
          'UDP announce response'
        );

        return result;
      } catch {
        attempt++;
        if (attempt > maxRetries) {
          throw new Error(`UDP announce failed after ${maxRetries + 1} attempts`);
        }
        logger.debug({ attempt }, 'UDP announce retry');
      }
    }

    throw new Error('UDP announce failed');
  } finally {
    socket.close();
  }
}
