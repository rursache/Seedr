import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';
import { resolve } from 'node:path';
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

// Optional Basic Auth — enabled only when both env vars are set
const AUTH_USERNAME = process.env['USERNAME'] || '';
const AUTH_PASSWORD = process.env['PASSWORD'] || '';
const AUTH_ENABLED = AUTH_USERNAME.length > 0 && AUTH_PASSWORD.length > 0;

export interface AuthConfig {
  enabled: boolean;
  username: string;
  password: string;
}

export function getAuthConfig(): AuthConfig {
  return { enabled: AUTH_ENABLED, username: AUTH_USERNAME, password: AUTH_PASSWORD };
}

/**
 * Verify Basic Auth credentials with timing-safe comparison.
 */
export function verifyBasicAuth(authHeader: string | undefined, config: AuthConfig): boolean {
  if (!config.enabled) return true;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return false;

    const user = decoded.slice(0, colonIdx);
    const pass = decoded.slice(colonIdx + 1);

    const userBuf = Buffer.from(user);
    const passBuf = Buffer.from(pass);
    const expectedUserBuf = Buffer.from(config.username);
    const expectedPassBuf = Buffer.from(config.password);

    // Timing-safe comparison (lengths must match for timingSafeEqual)
    const userMatch = userBuf.length === expectedUserBuf.length && timingSafeEqual(userBuf, expectedUserBuf);
    const passMatch = passBuf.length === expectedPassBuf.length && timingSafeEqual(passBuf, expectedPassBuf);

    return userMatch && passMatch;
  } catch {
    return false;
  }
}

export async function startWebServer(seedManager: SeedManager) {
  const server = Fastify({ logger: false });
  const authConfig = getAuthConfig();

  await server.register(fastifyCors, { origin: true });
  await server.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Optional Basic Auth — protect all routes when credentials are configured
  if (authConfig.enabled) {
    server.addHook('onRequest', async (request, reply) => {
      if (!verifyBasicAuth(request.headers.authorization, authConfig)) {
        reply.header('WWW-Authenticate', 'Basic realm="Seedr"');
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    });
    logger.info('Basic authentication enabled');
  }

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

  setupWebSocket(io, seedManager, authConfig);

  await server.listen({ port: PORT, host: HOST });
  logger.info({ host: HOST, port: PORT }, 'Web server listening');

  return { server, io };
}
