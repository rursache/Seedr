import type { Server } from 'socket.io';
import type { SeedManager } from '../core/seed-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket');

const BROADCAST_INTERVAL = 5000; // Broadcast full state every 5 seconds

export function setupWebSocket(io: Server, seedManager: SeedManager): void {
  let broadcastTimer: ReturnType<typeof setInterval> | null = null;

  // Forward internal events to WebSocket clients
  const events = [
    'torrent:added',
    'torrent:removed',
    'announce:success',
    'announce:failure',
    'config:updated',
    'started',
    'stopped',
  ];

  for (const event of events) {
    seedManager.on(event, (data) => {
      io.emit(event, data);
    });
  }

  // Broadcast full state periodically
  broadcastTimer = setInterval(() => {
    if (io.engine.clientsCount > 0) {
      io.emit('state', seedManager.getStatus());
    }
  }, BROADCAST_INTERVAL);

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id }, 'Client connected');

    // Send initial state
    socket.emit('state', seedManager.getStatus());

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
  });
}
