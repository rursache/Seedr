import type { FastifyInstance } from 'fastify';
import type { SeedManager } from '../../core/seed-manager.js';

export function registerControlRoutes(server: FastifyInstance, seedManager: SeedManager): void {
  server.post('/api/control/start', async () => {
    if (!seedManager.isRunning()) {
      await seedManager.start();
    }
    return { running: true };
  });

  server.post('/api/control/stop', async () => {
    if (seedManager.isRunning()) {
      await seedManager.stop();
    }
    return { running: false };
  });

  server.get('/api/control/status', async () => {
    return seedManager.getStatus();
  });

  server.post('/api/control/port-check', async (_request, reply) => {
    if (!seedManager.isRunning()) {
      return reply.status(400).send({
        error: 'Engine must be running to check port',
      });
    }

    await seedManager.recheckPort();
    return seedManager.getStatus().portCheck;
  });
}
