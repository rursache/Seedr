import type { FastifyInstance } from 'fastify';
import type { SeedManager } from '../../core/seed-manager.js';
import { validateConfigUpdate } from '../../config/config.js';

export function registerConfigRoutes(server: FastifyInstance, seedManager: SeedManager): void {
  server.get('/api/config', async () => {
    return seedManager.getConfig();
  });

  server.put('/api/config', async (request, reply) => {
    let validated;
    try {
      validated = validateConfigUpdate(request.body);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    try {
      return await seedManager.updateConfig(validated);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Config update failed' });
    }
  });

  server.get('/api/config/clients', async () => {
    return seedManager.getClientFiles();
  });
}
