import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UI_DIST = join(process.cwd(), 'ui', 'dist');
const INDEX_PATH = join(UI_DIST, 'index.html');

function createMockSeedManager() {
  return Object.assign(new EventEmitter(), {
    getStatus: vi.fn(() => ({ running: false, torrents: [] })),
    getConfig: vi.fn(() => ({ client: 'test', port: 49152 })),
    updateConfig: vi.fn((cfg: unknown) => cfg),
    getClientFiles: vi.fn(() => ['qbittorrent-5.1.4.client']),
    getTorrentList: vi.fn(() => []),
    addTorrent: vi.fn(() => true),
    removeTorrent: vi.fn(),
    forceAnnounce: vi.fn(() => true),
    isRunning: vi.fn(() => false),
    start: vi.fn(),
    stop: vi.fn(),
    recheckPort: vi.fn(),
  }) as any;
}

describe('startWebServer', () => {
  let previousIndex: string | null = null;
  let createdDist = false;

  beforeEach(() => {
    vi.resetModules();
    previousIndex = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf-8') : null;
    createdDist = !existsSync(UI_DIST);
    mkdirSync(UI_DIST, { recursive: true });
    writeFileSync(INDEX_PATH, '<html><body>seedr-spa</body></html>');
  });

  afterEach(() => {
    delete process.env['USERNAME'];
    delete process.env['PASSWORD'];
    delete process.env['WEB_PORT'];

    if (previousIndex === null) {
      rmSync(INDEX_PATH, { force: true });
    } else {
      writeFileSync(INDEX_PATH, previousIndex);
    }

    if (createdDist) {
      rmSync(UI_DIST, { recursive: true, force: true });
    }
  });

  it('enforces basic auth on API routes when credentials are configured', async () => {
    process.env['USERNAME'] = 'admin';
    process.env['PASSWORD'] = 'secret';
    process.env['WEB_PORT'] = '0';

    const { startWebServer } = await import('../src/web/server.js');
    const { server, io } = await startWebServer(createMockSeedManager());

    const unauthorized = await server.inject({ method: 'GET', url: '/api/version' });
    expect(unauthorized.statusCode).toBe(401);

    const auth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    const authorized = await server.inject({
      method: 'GET',
      url: '/api/version',
      headers: { authorization: auth },
    });
    expect(authorized.statusCode).toBe(200);

    io.close();
    await server.close();
  });

  it('serves SPA fallback for unknown non-api routes when ui/dist exists', async () => {
    process.env['WEB_PORT'] = '0';

    const { startWebServer } = await import('../src/web/server.js');
    const { server, io } = await startWebServer(createMockSeedManager());

    const res = await server.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('seedr-spa');

    io.close();
    await server.close();
  });
});
