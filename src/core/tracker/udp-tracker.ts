import dgram from 'node:dgram';
import type { AnnounceResponse, AnnounceEvent } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';
import {
  ACTION_CONNECT,
  buildAnnounceRequest,
  buildConnectRequest,
  getHostPort,
  parseAnnounceResponse,
} from './udp-protocol.js';

const logger = createLogger('udp-tracker');

interface ConnectionState {
  connectionId: bigint;
  timestamp: number;
}

// Cache connection IDs per tracker host (valid ~1 min)
const connectionCache = new Map<string, ConnectionState>();

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
 * Perform the BEP-15 connect handshake with retransmission.
 * Returns the 64-bit connection ID on success, throws on failure.
 */
async function udpConnect(
  socket: dgram.Socket,
  host: string,
  port: number,
  maxRetries: number
): Promise<bigint> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeout = 15000 * Math.pow(2, attempt);
    const { buffer: connectBuf, transactionId } = buildConnectRequest();

    try {
      const response = await sendAndReceive(
        socket,
        connectBuf,
        host,
        port,
        transactionId,
        timeout
      );

      const action = response.readUInt32BE(0);
      if (action !== ACTION_CONNECT || response.length < 16) {
        throw new Error('Invalid connect response');
      }

      return response.readBigInt64BE(8);
    } catch {
      if (attempt >= maxRetries) {
        throw new Error(`UDP connect failed after ${maxRetries + 1} attempts`);
      }
      logger.debug({ attempt: attempt + 1 }, 'UDP connect retry');
    }
  }

  throw new Error('UDP connect failed');
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
  socket.on('error', (err) => {
    logger.debug({ err: err.message }, 'UDP socket error');
  });

  try {
    // Check connection cache
    const cached = connectionCache.get(cacheKey);

    // Prune expired cache entries (older than 60s)
    const now = Date.now();
    for (const [key, state] of connectionCache) {
      if (now - state.timestamp > 60000) connectionCache.delete(key);
    }

    let connectionId: bigint;

    if (cached && now - cached.timestamp < 55000) {
      connectionId = cached.connectionId;
    } else {
      // Connect handshake with retransmission
      connectionId = await udpConnect(socket, host, trackerPort, maxRetries);
      connectionCache.set(cacheKey, { connectionId, timestamp: Date.now() });
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
