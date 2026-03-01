import type { FastifyInstance } from 'fastify';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { TORRENTS_DIR } from '../../config/config.js';
import type { SeedManager } from '../../core/seed-manager.js';

export function registerTorrentRoutes(server: FastifyInstance, seedManager: SeedManager): void {
  server.get('/api/torrents', async () => {
    return seedManager.getTorrentList();
  });

  server.post('/api/torrents', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const buffer = await data.toBuffer();
    const filename = data.filename;

    if (!filename.endsWith('.torrent')) {
      return reply.status(400).send({ error: 'File must be a .torrent' });
    }

    const filePath = join(TORRENTS_DIR, filename);
    writeFileSync(filePath, buffer);

    const added = seedManager.addTorrent(filePath);
    if (!added) {
      return reply.status(409).send({ error: 'Torrent already loaded or invalid' });
    }

    return { success: true, filename };
  });

  server.delete<{ Params: { infoHash: string } }>(
    '/api/torrents/:infoHash',
    async (request, reply) => {
      const { infoHash } = request.params;
      const torrents = seedManager.getTorrentList();
      const torrent = torrents.find((t) => t.infoHash === infoHash);

      if (!torrent) {
        return reply.status(404).send({ error: 'Torrent not found' });
      }

      seedManager.removeTorrent(infoHash);

      return { success: true };
    }
  );

  server.post<{ Params: { infoHash: string } }>(
    '/api/torrents/:infoHash/announce',
    async (request, reply) => {
      const { infoHash } = request.params;

      if (!seedManager.isRunning()) {
        return reply.status(400).send({ error: 'Engine is not running' });
      }

      const ok = await seedManager.forceAnnounce(infoHash);
      if (!ok) {
        return reply.status(404).send({ error: 'Torrent not found or not active' });
      }

      return { success: true };
    }
  );
}
