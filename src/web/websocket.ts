import type { Server } from 'socket.io';
import type { SeedManager } from '../core/seed-manager.js';
import type { AuthConfig } from './server.js';
import { verifyBasicAuth } from './server.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket');

const BROADCAST_INTERVAL = 1000; // Broadcast full state every second

export function setupWebSocket(io: Server, seedManager: SeedManager, authConfig?: AuthConfig): void {
  // Authenticate WebSocket connections when auth is enabled
  if (authConfig?.enabled) {
    io.use((socket, next) => {
      // Browser sends Basic Auth header on WebSocket upgrade from same origin
      const authHeader = socket.handshake.headers.authorization;
      if (verifyBasicAuth(authHeader, authConfig)) {
        return next();
      }
      // Fallback: check socket.handshake.auth for programmatic clients
      if (socket.handshake.auth?.token) {
        const tokenAuth = `Basic ${Buffer.from(socket.handshake.auth.token).toString('base64')}`;
        if (verifyBasicAuth(tokenAuth, authConfig)) {
          return next();
        }
      }
      next(new Error('Unauthorized'));
    });
  }
  let broadcastTimer: ReturnType<typeof setInterval> | null = null;

  // Forward internal events to WebSocket clients
  const events = [
    'torrent:added',
    'torrent:removed',
    'torrent:completed',
    'announce:success',
    'announce:failure',
    'config:updated',
    'started',
    'stopped',
  ];

  // config:updated carries the whole config, which is state rather than
  // something worth a line in the log, so it is forwarded but not recorded.
  const notLogged = new Set(['config:updated']);

  const eventHandlers = new Map<string, (data: any) => void>();

  for (const event of events) {
    const handler = (data: any) => {
      io.emit(event, data);
      if (!notLogged.has(event)) {
        // Recorded once here, with the time it happened and a stable id, then
        // pushed to clients as a log record separate from the domain event
        io.emit('event:new', seedManager.eventLog.record(event, data ?? {}));
      }
    };
    eventHandlers.set(event, handler);
    seedManager.on(event, handler);
  }

  // Broadcast full state periodically
  broadcastTimer = setInterval(() => {
    if (io.engine.clientsCount > 0) {
      io.emit('state', seedManager.getStatus());
    }
  }, BROADCAST_INTERVAL);

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id }, 'Client connected');

    socket.on('error', (err) => {
      logger.debug({ id: socket.id, err: err.message }, 'Socket error');
    });

    // Send initial state
    socket.emit('state', seedManager.getStatus());

    // One snapshot the client replaces its log with, rather than a replay of
    // individual events that a reconnect would append a second time
    socket.emit('events:snapshot', seedManager.eventLog.list());

    socket.on('disconnect', () => {
      logger.debug({ id: socket.id }, 'Client disconnected');
    });
  });

  // Cleanup on close
  io.on('close', () => {
    if (broadcastTimer) {
      clearInterval(broadcastTimer);
      broadcastTimer = null;
    }
    for (const [event, handler] of eventHandlers) {
      seedManager.off(event, handler);
    }
    eventHandlers.clear();
  });
}
