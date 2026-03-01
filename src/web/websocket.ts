import type { Server } from 'socket.io';
import type { SeedManager } from '../core/seed-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket');

const BROADCAST_INTERVAL = 1000; // Broadcast full state every second
const MAX_RECENT_EVENTS = 50;

interface RecentEvent {
  type: string;
  data: any;
  time: number;
}

export function setupWebSocket(io: Server, seedManager: SeedManager): void {
  let broadcastTimer: ReturnType<typeof setInterval> | null = null;
  const recentEvents: RecentEvent[] = [];

  function pushEvent(type: string, data: any) {
    recentEvents.push({ type, data, time: Date.now() });
    if (recentEvents.length > MAX_RECENT_EVENTS) {
      recentEvents.shift();
    }
  }

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

  for (const event of events) {
    seedManager.on(event, (data) => {
      pushEvent(event, data);
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

    // Send recent events so the client can populate the event log
    for (const evt of recentEvents) {
      socket.emit(evt.type, evt.data);
    }

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
