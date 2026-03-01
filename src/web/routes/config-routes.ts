import type { FastifyInstance } from 'fastify';
import type { SeedManager } from '../../core/seed-manager.js';

export function registerConfigRoutes(server: FastifyInstance, seedManager: SeedManager): void {
  server.get('/api/config', async () => {
    return seedManager.getConfig();
  });

  server.put('/api/config', async (request) => {
    const updates = request.body as Record<string, unknown>;
    return await seedManager.updateConfig(updates);
  });

  server.get('/api/config/clients', async () => {
    return seedManager.getClientFiles();
  });
}
