import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { registerTorrentRoutes } from '../src/web/routes/torrent-routes.js';
import { registerControlRoutes } from '../src/web/routes/control-routes.js';
import { registerConfigRoutes } from '../src/web/routes/config-routes.js';
import { verifyBasicAuth, type AuthConfig } from '../src/web/server.js';

// ---------- Mock SeedManager ----------

function createMockSeedManager() {
  return {
    getTorrentList: vi.fn(() => [
      {
        infoHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        name: 'test-torrent',
        size: 1024,
        uploaded: 512,
        active: true,
        seeding: true,
      },
    ]),
    addTorrent: vi.fn(() => true),
    removeTorrent: vi.fn(),
    forceAnnounce: vi.fn(() => true),
    isRunning: vi.fn(() => true),
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({ running: true, torrents: [] })),
    getConfig: vi.fn(() => ({ client: 'test', port: 49152 })),
    updateConfig: vi.fn((cfg: unknown) => cfg),
    getClientFiles: vi.fn(() => ['qbittorrent-5.1.0', 'deluge-2.1.1']),
    recheckPort: vi.fn(),
  } as any;
}

// ---------- Torrent Routes ----------

describe('Torrent Routes', () => {
  let server: FastifyInstance;
  let mockSM: ReturnType<typeof createMockSeedManager>;

  beforeEach(async () => {
    server = Fastify();
    await server.register(fastifyMultipart);
    mockSM = createMockSeedManager();
    registerTorrentRoutes(server, mockSM);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/torrents returns torrent list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/torrents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('test-torrent');
  });

  it('DELETE /api/torrents/:infoHash rejects invalid hash format', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/torrents/not-a-valid-hash',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid infoHash/);
  });

  it('DELETE /api/torrents/:infoHash removes a torrent', async () => {
    const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/torrents/${hash}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(mockSM.removeTorrent).toHaveBeenCalledWith(hash);
  });

  it('DELETE /api/torrents/:infoHash returns 404 for unknown hash', async () => {
    mockSM.getTorrentList.mockReturnValueOnce([]);
    const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await server.inject({
      method: 'DELETE',
      url: `/api/torrents/${hash}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/torrents/:infoHash/announce rejects invalid hash format', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/torrents/xyz/announce',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid infoHash/);
  });

  it('POST /api/torrents/:infoHash/announce forces announce', async () => {
    const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const res = await server.inject({
      method: 'POST',
      url: `/api/torrents/${hash}/announce`,
    });
    expect(res.statusCode).toBe(200);
    expect(mockSM.forceAnnounce).toHaveBeenCalledWith(hash);
  });

  it('POST /api/torrents/:infoHash/announce returns 400 when engine not running', async () => {
    mockSM.isRunning.mockReturnValueOnce(false);
    const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const res = await server.inject({
      method: 'POST',
      url: `/api/torrents/${hash}/announce`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not running/);
  });
});

// ---------- Control Routes ----------

describe('Control Routes', () => {
  let server: FastifyInstance;
  let mockSM: ReturnType<typeof createMockSeedManager>;

  beforeEach(async () => {
    server = Fastify();
    mockSM = createMockSeedManager();
    registerControlRoutes(server, mockSM);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('POST /api/control/start starts seeding', async () => {
    mockSM.isRunning.mockReturnValueOnce(false);
    const res = await server.inject({ method: 'POST', url: '/api/control/start' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(true);
    expect(mockSM.start).toHaveBeenCalled();
  });

  it('POST /api/control/start does not restart if already running', async () => {
    mockSM.isRunning.mockReturnValueOnce(true);
    const res = await server.inject({ method: 'POST', url: '/api/control/start' });
    expect(res.statusCode).toBe(200);
    expect(mockSM.start).not.toHaveBeenCalled();
  });

  it('POST /api/control/stop stops seeding', async () => {
    mockSM.isRunning.mockReturnValueOnce(true);
    const res = await server.inject({ method: 'POST', url: '/api/control/stop' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(false);
    expect(mockSM.stop).toHaveBeenCalled();
  });

  it('GET /api/control/status returns status', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/control/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().running).toBe(true);
  });

  it('POST /api/control/port-check returns 400 when not running', async () => {
    mockSM.isRunning.mockReturnValueOnce(false);
    const res = await server.inject({ method: 'POST', url: '/api/control/port-check' });
    expect(res.statusCode).toBe(400);
  });
});

// ---------- Config Routes ----------

describe('Config Routes', () => {
  let server: FastifyInstance;
  let mockSM: ReturnType<typeof createMockSeedManager>;

  beforeEach(async () => {
    server = Fastify();
    mockSM = createMockSeedManager();
    registerConfigRoutes(server, mockSM);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/config returns config', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().client).toBe('test');
  });

  it('GET /api/config/clients returns client list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/config/clients' });
    expect(res.statusCode).toBe(200);
    const clients = res.json();
    expect(clients).toContain('qbittorrent-5.1.0');
  });
});

// ---------- Basic Auth ----------

describe('verifyBasicAuth', () => {
  const config: AuthConfig = { enabled: true, username: 'admin', password: 'secret' };

  it('should pass when auth is disabled', () => {
    expect(verifyBasicAuth(undefined, { enabled: false, username: '', password: '' })).toBe(true);
  });

  it('should reject when no header is provided', () => {
    expect(verifyBasicAuth(undefined, config)).toBe(false);
  });

  it('should reject non-Basic auth', () => {
    expect(verifyBasicAuth('Bearer token123', config)).toBe(false);
  });

  it('should accept valid credentials', () => {
    const encoded = Buffer.from('admin:secret').toString('base64');
    expect(verifyBasicAuth(`Basic ${encoded}`, config)).toBe(true);
  });

  it('should reject wrong username', () => {
    const encoded = Buffer.from('wrong:secret').toString('base64');
    expect(verifyBasicAuth(`Basic ${encoded}`, config)).toBe(false);
  });

  it('should reject wrong password', () => {
    const encoded = Buffer.from('admin:wrong').toString('base64');
    expect(verifyBasicAuth(`Basic ${encoded}`, config)).toBe(false);
  });

  it('should reject malformed base64', () => {
    expect(verifyBasicAuth('Basic !!!invalid!!!', config)).toBe(false);
  });
});
