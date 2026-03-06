import { describe, expect, it, vi } from 'vitest';

describe('SeedManager file watcher', () => {
  it('wires add and unlink watcher events to torrent handlers', async () => {
    vi.resetModules();

    const handlers = new Map<string, (filePath: string) => void>();
    vi.doMock('chokidar', () => ({
      watch: vi.fn(() => ({
        on(event: string, handler: (filePath: string) => void) {
          handlers.set(event, handler);
          return this;
        },
        close: vi.fn(async () => {}),
      })),
    }));

    const { SeedManager } = await import('../src/core/seed-manager.js');
    const manager = new SeedManager(true) as any;
    manager.torrents = new Map([
      ['abc', {
        meta: { filePath: '/tmp/watched.torrent', name: 'watched' },
      }],
    ]);
    manager.addTorrent = vi.fn();
    manager.removeTorrent = vi.fn();

    manager.startFileWatcher();
    handlers.get('add')?.('/tmp/new.torrent');
    handlers.get('unlink')?.('/tmp/watched.torrent');

    expect(manager.addTorrent).toHaveBeenCalledWith('/tmp/new.torrent');
    expect(manager.removeTorrent).toHaveBeenCalledWith('abc');
  });
});
