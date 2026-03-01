import type { FastifyInstance } from 'fastify';
import type { SeedManager } from '../../core/seed-manager.js';
import { checkPortReachable } from '../../utils/port-checker.js';

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

  server.get('/api/control/port-check', async (_request, reply) => {
    const status = seedManager.getStatus();

    if (!status.running || !status.externalIp) {
      return reply.status(400).send({
        error: 'Engine must be running with a resolved external IP to check port',
      });
    }

    try {
      const result = await checkPortReachable(status.externalIp, status.port);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(502).send({ error: msg });
    }
  });
}
