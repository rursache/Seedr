import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { Server } from 'socket.io';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { SeedManager } from '../core/seed-manager.js';
import { registerConfigRoutes } from './routes/config-routes.js';
import { registerTorrentRoutes } from './routes/torrent-routes.js';
import { registerControlRoutes } from './routes/control-routes.js';
import { setupWebSocket } from './websocket.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('web');

const HOST = process.env['HOST'] || '0.0.0.0';
const PORT = parseInt(process.env['WEB_PORT'] || '8080', 10);

export async function startWebServer(seedManager: SeedManager) {
  const server = Fastify({ logger: false });

  await server.register(fastifyCors, { origin: true });
  await server.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Serve Vue.js SPA in production
  const uiDist = resolve('ui/dist');
  if (existsSync(uiDist)) {
    await server.register(fastifyStatic, {
      root: uiDist,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback
    server.setNotFoundHandler((_req, reply) => {
      return reply.sendFile('index.html');
    });
  }

  // Register API routes
  registerConfigRoutes(server, seedManager);
  registerTorrentRoutes(server, seedManager);
  registerControlRoutes(server, seedManager);

  // Socket.IO
  const io = new Server(server.server, {
    cors: { origin: '*' },
  });

  setupWebSocket(io, seedManager);

  await server.listen({ port: PORT, host: HOST });
  logger.info({ host: HOST, port: PORT }, 'Web server listening');

  return { server, io };
}
