import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from '../ui/node_modules/pinia/dist/pinia.mjs';
import { ref } from '../ui/node_modules/vue/index.mjs';

type Handler = (payload?: any) => void;

class FakeSocket {
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);
    return this;
  }

  emitLocal(event: string, payload?: any) {
    for (const handler of this.handlers.get(event) || []) {
      handler(payload);
    }
  }
}

let fakeSocket: FakeSocket;
let connectedRef: ReturnType<typeof ref<boolean>>;

vi.mock('../ui/src/composables/useWebSocket.ts', () => ({
  useWebSocket: () => ({
    socket: fakeSocket,
    connected: connectedRef,
  }),
}));

import { useSeedrStore } from '../ui/src/stores/seedr';

function jsonResponse(body: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('Seedr store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fakeSocket = new FakeSocket();
    connectedRef = ref(true);
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
  });

  it('maps websocket state payloads into torrent rows and clears pending actions', () => {
    const store = useSeedrStore();
    store.actionPending = true;

    fakeSocket.emitLocal('state', {
      running: true,
      torrents: [
        {
          meta: {
            name: 'Ubuntu ISO',
            filePath: '/tmp/ubuntu.torrent',
            totalSize: 1024,
          },
          seedState: {
            infoHash: 'abc123',
            uploaded: 2048,
          },
          reportedUploaded: 1024,
          seeders: 10,
          leechers: 4,
          active: true,
          seeding: true,
          completed: false,
          lastFailureTransient: false,
          currentTracker: 'http://tracker.example.com/announce',
          uploadRate: 512,
          consecutiveFailures: 0,
        },
      ],
      portCheck: { checking: false, result: null, error: null },
    });

    expect(store.status?.running).toBe(true);
    expect(store.torrents).toHaveLength(1);
    expect(store.torrents[0]).toMatchObject({
      infoHash: 'abc123',
      name: 'Ubuntu ISO',
      fileName: 'ubuntu.torrent',
      uploaded: 2048,
      reportedUploaded: 1024,
      tracker: 'http://tracker.example.com/announce',
      active: true,
      seeding: true,
      lastFailureTransient: false,
    });
    expect(store.actionPending).toBe(false);
  });

  it('records torrent-added events and refreshes the torrent list', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse([
      {
        infoHash: 'hash-1',
        name: 'Torrent One',
        fileName: 'one.torrent',
        size: 100,
        uploaded: 0,
        reportedUploaded: 0,
        seeders: 0,
        leechers: 0,
        active: false,
        seeding: false,
        completed: false,
        tracker: '',
        uploadRate: 0,
        consecutiveFailures: 0,
        addedIndex: 0,
      },
    ]));

    const store = useSeedrStore();
    fakeSocket.emitLocal('torrent:added', { infoHash: 'hash-1', name: 'Torrent One' });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.events[0]?.type).toBe('torrent:added');
    expect(fetchMock).toHaveBeenCalledWith('/api/torrents');
    expect(store.torrents[0]?.name).toBe('Torrent One');
  });

  it('clears live state on websocket disconnect', () => {
    const store = useSeedrStore();
    store.status = { running: true } as any;
    store.torrents = [{ infoHash: 'abc' }] as any;

    fakeSocket.emitLocal('disconnect');

    expect(store.status).toBeNull();
    expect(store.torrents).toEqual([]);
  });

  it('fetches config, clients, and version data through the REST helpers', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ client: 'qbittorrent', showFileName: true }))
      .mockResolvedValueOnce(jsonResponse(['qbittorrent-5.1.4.client']))
      .mockResolvedValueOnce(jsonResponse({ version: '1.0.0', commit: 'abc', buildDate: 'today', isTagged: true }));

    const store = useSeedrStore();
    await store.fetchConfig();
    await store.fetchClients();
    await store.fetchVersion();

    expect(store.config?.client).toBe('qbittorrent');
    expect(store.configLoaded).toBe(true);
    expect(store.clients).toEqual(['qbittorrent-5.1.4.client']);
    expect(store.versionInfo?.version).toBe('1.0.0');
  });

  it('updates config through the REST helper', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ client: 'rtorrent', simultaneousSeed: 5 }));

    const store = useSeedrStore();
    await store.updateConfig({ simultaneousSeed: 5 });

    expect(fetchMock).toHaveBeenCalledWith('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simultaneousSeed: 5 }),
    });
    expect(store.config?.client).toBe('rtorrent');
    expect(store.config?.simultaneousSeed).toBe(5);
  });

  it('exposes computed counts using config-based eligibility rules', () => {
    const store = useSeedrStore();
    store.config = {
      keepTorrentWithZeroLeechers: false,
      skipIfNoPeers: true,
      minLeechers: 1,
      minSeeders: 1,
    } as any;

    fakeSocket.emitLocal('state', {
      running: true,
      torrents: [
        {
          meta: { name: 'Active', filePath: '/tmp/active.torrent', totalSize: 10 },
          seedState: { infoHash: 'a', uploaded: 10 },
          reportedUploaded: 5,
          seeders: 4,
          leechers: 3,
          active: true,
          seeding: true,
          completed: false,
          lastFailureTransient: false,
          currentTracker: 'tracker-a',
          consecutiveFailures: 0,
        },
        {
          meta: { name: 'Waiting', filePath: '/tmp/waiting.torrent', totalSize: 10 },
          seedState: { infoHash: 'b', uploaded: 0 },
          reportedUploaded: 0,
          seeders: 0,
          leechers: 0,
          active: false,
          seeding: true,
          completed: false,
          lastFailureTransient: true,
          currentTracker: 'tracker-b',
          consecutiveFailures: 0,
        },
        {
          meta: { name: 'Errored', filePath: '/tmp/error.torrent', totalSize: 10 },
          seedState: { infoHash: 'c', uploaded: 0 },
          reportedUploaded: 0,
          seeders: 2,
          leechers: 2,
          active: false,
          seeding: false,
          completed: false,
          lastFailureTransient: false,
          currentTracker: 'tracker-c',
          consecutiveFailures: 2,
        },
        {
          meta: { name: 'Completed', filePath: '/tmp/completed.torrent', totalSize: 10 },
          seedState: { infoHash: 'd', uploaded: 0 },
          reportedUploaded: 0,
          seeders: 2,
          leechers: 2,
          active: false,
          seeding: true,
          completed: true,
          lastFailureTransient: false,
          currentTracker: 'tracker-d',
          consecutiveFailures: 0,
        },
      ],
      portCheck: { checking: false, result: null, error: null },
    });

    expect(store.activeCount).toBe(1);
    expect(store.seedingCount).toBe(1);
    expect(store.waitingCount).toBe(1);
    expect(store.errorCount).toBe(1);
    expect(store.completedCount).toBe(1);
    expect(store.isSeeding).toBe(true);
    expect(store.torrents[1]?.lastFailureTransient).toBe(true);
  });

  it('removes a torrent optimistically and refetches when delete fails', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as any)
      .mockResolvedValueOnce(jsonResponse([
        {
          infoHash: 'kept',
          name: 'Kept',
          fileName: 'kept.torrent',
          size: 100,
          uploaded: 0,
          reportedUploaded: 0,
          seeders: 0,
          leechers: 1,
          active: false,
          seeding: false,
          completed: false,
          tracker: '',
          uploadRate: 0,
          consecutiveFailures: 0,
          addedIndex: 0,
        },
      ]));

    const store = useSeedrStore();
    store.torrents = [
      { infoHash: 'gone', name: 'Gone' },
      { infoHash: 'kept', name: 'Kept' },
    ] as any;

    await store.removeTorrent('gone');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/torrents/gone', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/torrents');
    expect(store.torrents).toHaveLength(1);
    expect(store.torrents[0]?.infoHash).toBe('kept');
  });

  it('posts control and announce helpers to the expected endpoints', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(jsonResponse({}));

    const store = useSeedrStore();
    await store.checkPort();
    await store.forceAnnounce('abc123');
    await store.startSeeding();
    await store.stopSeeding();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/control/port-check', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/torrents/abc123/announce', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/control/start', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/control/stop', { method: 'POST' });
  });

  it('caps the in-memory event log at 100 entries', () => {
    const store = useSeedrStore();

    for (let i = 0; i < 105; i++) {
      fakeSocket.emitLocal('announce:success', { index: i });
    }

    expect(store.events).toHaveLength(100);
    expect(store.events[0]?.data).toEqual({ index: 104 });
    expect(store.events.at(-1)?.data).toEqual({ index: 5 });
  });

  it('resets pending actions when a control request fails', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const store = useSeedrStore();
    await store.startSeeding();
    expect(store.actionPending).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await store.stopSeeding();
    expect(store.actionPending).toBe(false);
  });
});
