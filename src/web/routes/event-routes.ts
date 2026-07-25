import type { FastifyInstance } from 'fastify';
import type { SeedManager } from '../../core/seed-manager.js';

export function registerEventRoutes(server: FastifyInstance, seedManager: SeedManager): void {
  server.get<{ Querystring: { limit?: string } }>('/api/events', async (request) => {
    const raw = Number(request.query.limit);
    return Number.isFinite(raw) && raw > 0
      ? seedManager.eventLog.list(raw)
      : seedManager.eventLog.list();
  });

  server.delete('/api/events', async () => {
    seedManager.eventLog.clear();
    return { success: true };
  });

  server.delete<{ Params: { id: string } }>('/api/events/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(400).send({ error: 'Invalid event id' });
    }
    if (!seedManager.eventLog.remove(id)) {
      return reply.status(404).send({ error: 'Event not found' });
    }
    return { success: true };
  });
}
