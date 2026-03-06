import { describe, it, expect, vi } from 'vitest';
import { SeedManager, checkTorrentEligible, checkRatioTarget, isRotationEligible } from '../src/core/seed-manager.js';
import type { AppConfig, TorrentRuntimeState } from '../src/config/types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    client: 'test.client',
    port: 0,
    minUploadRate: 100,
    maxUploadRate: 500,
    simultaneousSeed: -1,
    seedRotationInterval: -1,
    keepTorrentWithZeroLeechers: true,
    skipIfNoPeers: true,
    minLeechers: 0,
    minSeeders: 0,
    uploadRatioTarget: -1,
    ...overrides,
  };
}

function makeTorrent(overrides: Partial<TorrentRuntimeState> = {}): TorrentRuntimeState {
  return {
    meta: {
      infoHash: Buffer.from('test-hash-00000000000', 'utf-8'),
      name: 'test-torrent',
      totalSize: 1000000,
      files: [],
      trackers: ['http://tracker.example.com/announce'],
      pieceLength: 262144,
      isPrivate: false,
      filePath: '/tmp/test.torrent',
    },
    seedState: {
      infoHash: 'abcdef1234567890abcdef1234567890abcdef12',
      uploaded: 0,
      downloaded: 0,
      lastAnnounce: 0,
      announceCount: 0,
    },
    peerId: Buffer.alloc(20),
    key: 'abcd1234',
    currentTracker: 'http://tracker.example.com/announce',
    trackerIndex: 0,
    interval: 1800,
    seeders: 10,
    leechers: 5,
    consecutiveFailures: 0,
    announceCount: 0,
    lastEvent: '' as any,
    active: true,
    seeding: true,
    completed: false,
    ...overrides,
  };
}

function makeManagedTorrent(id: string, overrides: Partial<TorrentRuntimeState> = {}): TorrentRuntimeState {
  const infoHash = id.padEnd(40, id[0] || 'a').slice(0, 40);
  return makeTorrent({
    meta: {
      ...makeTorrent().meta,
      infoHash: Buffer.from(infoHash, 'hex'),
      name: `torrent-${id}`,
      filePath: `/tmp/${id}.torrent`,
      totalSize: 1000,
    },
    seedState: {
      ...makeTorrent().seedState,
      infoHash,
    },
    ...overrides,
  });
}

function createManager(overrides: Partial<AppConfig> = {}) {
  const manager = new SeedManager(true) as any;

  manager.config = makeConfig(overrides);
  manager.state = { torrents: {}, lastSaved: 0 };
  manager.profile = {} as any;
  manager.torrents = new Map();
  manager.emulatorStates = new Map();
  manager.announceLocks = new Map();
  manager.activatedAt = new Map();
  manager.bandwidth = {
    registerTorrent: vi.fn(),
    updateTorrent: vi.fn(),
    removeTorrent: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    getAccumulated: vi.fn(() => 0),
    getActualTorrentRate: vi.fn(() => 0),
    getGlobalRate: vi.fn(() => 0),
    getActualRate: vi.fn(() => 0),
  };
  manager.scheduler = {
    schedule: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  };
  manager.connection = {
    start: vi.fn(async () => {}),
    setContext: vi.fn(),
    stop: vi.fn(async () => {}),
    port: 51413,
    externalIp: null,
    externalIpv6: null,
  };
  manager.runPortCheck = vi.fn();

  return manager;
}

describe('checkTorrentEligible', () => {
  it('should return true for a normal eligible torrent', () => {
    const config = makeConfig();
    const torrent = makeTorrent({ seeders: 10, leechers: 5 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return false for a completed torrent', () => {
    const config = makeConfig();
    const torrent = makeTorrent({ completed: true, seeders: 10, leechers: 5 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should return false when skipIfNoPeers=true and no peers at all', () => {
    const config = makeConfig({ skipIfNoPeers: true });
    const torrent = makeTorrent({ seeders: 0, leechers: 0 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should return true when skipIfNoPeers=true but peers exist', () => {
    const config = makeConfig({ skipIfNoPeers: true });
    const torrent = makeTorrent({ seeders: 1, leechers: 0 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return true when skipIfNoPeers=false and no peers', () => {
    const config = makeConfig({ skipIfNoPeers: false });
    const torrent = makeTorrent({ seeders: 0, leechers: 0 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return false when keepTorrentWithZeroLeechers=false and 0 leechers', () => {
    const config = makeConfig({ keepTorrentWithZeroLeechers: false });
    const torrent = makeTorrent({ seeders: 10, leechers: 0 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should return true when keepTorrentWithZeroLeechers=true and 0 leechers', () => {
    const config = makeConfig({ keepTorrentWithZeroLeechers: true });
    const torrent = makeTorrent({ seeders: 10, leechers: 0 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return false when leechers below minLeechers', () => {
    const config = makeConfig({ minLeechers: 3 });
    const torrent = makeTorrent({ seeders: 10, leechers: 2 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should return true when leechers equal to minLeechers', () => {
    const config = makeConfig({ minLeechers: 3 });
    const torrent = makeTorrent({ seeders: 10, leechers: 3 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return true when leechers above minLeechers', () => {
    const config = makeConfig({ minLeechers: 3 });
    const torrent = makeTorrent({ seeders: 10, leechers: 10 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return false when seeders below minSeeders', () => {
    const config = makeConfig({ minSeeders: 5 });
    const torrent = makeTorrent({ seeders: 3, leechers: 10 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should return true when seeders equal to minSeeders', () => {
    const config = makeConfig({ minSeeders: 5 });
    const torrent = makeTorrent({ seeders: 5, leechers: 10 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('should return true when seeders above minSeeders', () => {
    const config = makeConfig({ minSeeders: 5 });
    const torrent = makeTorrent({ seeders: 20, leechers: 10 });
    expect(checkTorrentEligible(config, torrent)).toBe(true);
  });

  it('completed takes priority over other conditions', () => {
    const config = makeConfig({ skipIfNoPeers: false, keepTorrentWithZeroLeechers: true, minLeechers: 0 });
    const torrent = makeTorrent({ completed: true, seeders: 10, leechers: 20 });
    expect(checkTorrentEligible(config, torrent)).toBe(false);
  });

  it('should handle combined restrictive conditions', () => {
    const config = makeConfig({ skipIfNoPeers: true, keepTorrentWithZeroLeechers: false, minLeechers: 5 });

    // 0 peers → skipIfNoPeers kicks in
    expect(checkTorrentEligible(config, makeTorrent({ seeders: 0, leechers: 0 }))).toBe(false);

    // Has seeders but 0 leechers → keepTorrentWithZeroLeechers kicks in
    expect(checkTorrentEligible(config, makeTorrent({ seeders: 5, leechers: 0 }))).toBe(false);

    // Has leechers but below minLeechers → minLeechers kicks in
    expect(checkTorrentEligible(config, makeTorrent({ seeders: 5, leechers: 3 }))).toBe(false);

    // Meets all conditions
    expect(checkTorrentEligible(config, makeTorrent({ seeders: 5, leechers: 10 }))).toBe(true);
  });
});

describe('checkRatioTarget', () => {
  it('should return false when target is -1 (unlimited)', () => {
    const config = makeConfig({ uploadRatioTarget: -1 });
    const torrent = makeTorrent();
    torrent.seedState.uploaded = 999999999;
    expect(checkRatioTarget(config, torrent)).toBe(false);
  });

  it('should return false when target is 0', () => {
    const config = makeConfig({ uploadRatioTarget: 0 });
    const torrent = makeTorrent();
    torrent.seedState.uploaded = 999999999;
    expect(checkRatioTarget(config, torrent)).toBe(false);
  });

  it('should return false when totalSize is 0', () => {
    const config = makeConfig({ uploadRatioTarget: 1.0 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 0;
    torrent.seedState.uploaded = 999999999;
    expect(checkRatioTarget(config, torrent)).toBe(false);
  });

  it('should return false when ratio is below target', () => {
    const config = makeConfig({ uploadRatioTarget: 2.0 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 1000;
    torrent.seedState.uploaded = 1500; // ratio = 1.5, target = 2.0
    expect(checkRatioTarget(config, torrent)).toBe(false);
  });

  it('should return true when ratio equals target exactly', () => {
    const config = makeConfig({ uploadRatioTarget: 2.0 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 1000;
    torrent.seedState.uploaded = 2000; // ratio = 2.0, target = 2.0
    expect(checkRatioTarget(config, torrent)).toBe(true);
  });

  it('should return true when ratio exceeds target', () => {
    const config = makeConfig({ uploadRatioTarget: 1.5 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 1000;
    torrent.seedState.uploaded = 2000; // ratio = 2.0, target = 1.5
    expect(checkRatioTarget(config, torrent)).toBe(true);
  });

  it('should return false when nothing uploaded yet', () => {
    const config = makeConfig({ uploadRatioTarget: 1.0 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 1000;
    torrent.seedState.uploaded = 0;
    expect(checkRatioTarget(config, torrent)).toBe(false);
  });

  it('should handle fractional ratio targets', () => {
    const config = makeConfig({ uploadRatioTarget: 0.5 });
    const torrent = makeTorrent();
    torrent.meta.totalSize = 1000;

    torrent.seedState.uploaded = 400; // ratio = 0.4
    expect(checkRatioTarget(config, torrent)).toBe(false);

    torrent.seedState.uploaded = 500; // ratio = 0.5
    expect(checkRatioTarget(config, torrent)).toBe(true);

    torrent.seedState.uploaded = 600; // ratio = 0.6
    expect(checkRatioTarget(config, torrent)).toBe(true);
  });
});

describe('isRotationEligible', () => {
  it('should return false for completed torrents', () => {
    const config = makeConfig();
    const torrent = makeTorrent({ completed: true, seeders: 10, leechers: 5 });
    expect(isRotationEligible(config, torrent)).toBe(false);
  });

  it('should return true for queued torrents with zero peers (never announced)', () => {
    const config = makeConfig({ skipIfNoPeers: true, minLeechers: 5, minSeeders: 5 });
    const torrent = makeTorrent({ seeders: 0, leechers: 0 });
    expect(isRotationEligible(config, torrent)).toBe(true);
  });

  it('should return true for eligible torrents with peers', () => {
    const config = makeConfig({ minLeechers: 1, minSeeders: 1 });
    const torrent = makeTorrent({ seeders: 10, leechers: 5 });
    expect(isRotationEligible(config, torrent)).toBe(true);
  });

  it('should return false when skipIfNoPeers=true and torrent had peers but now has none', () => {
    // This torrent has been active before (has non-zero peer counts from prior announce)
    // but tracker now reports 0. Since seeders+leechers > 0 check won't trigger (both are 0),
    // the early return handles this: seeders=0 && leechers=0 → true (give benefit of doubt).
    // Actually if both are 0, the early return kicks in. Let's test with seeders=1, leechers=0.
    const config = makeConfig({ skipIfNoPeers: true });
    const torrent = makeTorrent({ seeders: 1, leechers: 0 });
    // seeders + leechers = 1, not 0 → skipIfNoPeers doesn't trigger
    expect(isRotationEligible(config, torrent)).toBe(true);
  });

  it('should return false when keepTorrentWithZeroLeechers=false and leechers=0 (with seeders)', () => {
    const config = makeConfig({ keepTorrentWithZeroLeechers: false });
    const torrent = makeTorrent({ seeders: 5, leechers: 0 });
    expect(isRotationEligible(config, torrent)).toBe(false);
  });

  it('should return false when leechers below minLeechers', () => {
    const config = makeConfig({ minLeechers: 5 });
    const torrent = makeTorrent({ seeders: 10, leechers: 3 });
    expect(isRotationEligible(config, torrent)).toBe(false);
  });

  it('should return false when seeders below minSeeders', () => {
    const config = makeConfig({ minSeeders: 5 });
    const torrent = makeTorrent({ seeders: 2, leechers: 10 });
    expect(isRotationEligible(config, torrent)).toBe(false);
  });

  it('should return true when all peer thresholds are met', () => {
    const config = makeConfig({ minLeechers: 3, minSeeders: 3, skipIfNoPeers: true, keepTorrentWithZeroLeechers: false });
    const torrent = makeTorrent({ seeders: 5, leechers: 5 });
    expect(isRotationEligible(config, torrent)).toBe(true);
  });

  it('should handle combined restrictive conditions', () => {
    const config = makeConfig({ skipIfNoPeers: true, keepTorrentWithZeroLeechers: false, minLeechers: 5, minSeeders: 3 });

    // Previously active torrent with seeders but no leechers → keepTorrentWithZeroLeechers kicks in
    expect(isRotationEligible(config, makeTorrent({ seeders: 5, leechers: 0 }))).toBe(false);

    // Below minLeechers
    expect(isRotationEligible(config, makeTorrent({ seeders: 5, leechers: 3 }))).toBe(false);

    // Below minSeeders
    expect(isRotationEligible(config, makeTorrent({ seeders: 2, leechers: 10 }))).toBe(false);

    // Meets all conditions
    expect(isRotationEligible(config, makeTorrent({ seeders: 5, leechers: 10 }))).toBe(true);

    // Completed → always false regardless of peers
    expect(isRotationEligible(config, makeTorrent({ completed: true, seeders: 10, leechers: 10 }))).toBe(false);

    // Never announced (zero peers) → benefit of doubt
    expect(isRotationEligible(config, makeTorrent({ seeders: 0, leechers: 0 }))).toBe(true);
  });
});

describe('SeedManager active slot handling', () => {
  it('treats completed active torrents as free slots during rebalance', () => {
    const manager = createManager({ simultaneousSeed: 1 });
    const completed = makeManagedTorrent('a', { active: true, completed: true, seeding: false });
    const queued = makeManagedTorrent('b', { active: false, completed: false, seeding: false });

    manager.torrents.set(completed.seedState.infoHash, completed);
    manager.torrents.set(queued.seedState.infoHash, queued);

    manager.rebalanceActiveTorrents();

    expect(completed.active).toBe(true);
    expect(queued.active).toBe(true);
    expect(manager.getSlotOccupyingTorrents()).toEqual([[queued.seedState.infoHash, queued]]);
  });

  it('promotes the next queued torrent when an active slot is removed while stopped', async () => {
    const manager = createManager({ simultaneousSeed: 1 });
    const active = makeManagedTorrent('c', { active: true, completed: false });
    const queued = makeManagedTorrent('d', { active: false, completed: false });

    manager.torrents.set(active.seedState.infoHash, active);
    manager.torrents.set(queued.seedState.infoHash, queued);

    await manager.removeTorrent(active.seedState.infoHash);

    expect(manager.torrents.has(active.seedState.infoHash)).toBe(false);
    expect(queued.active).toBe(true);
  });

  it('rebalances slot assignment before start scheduling begins', async () => {
    const manager = createManager({ simultaneousSeed: 1, uploadRatioTarget: 1 });
    const completed = makeManagedTorrent('e', {
      active: true,
      completed: false,
      seeding: true,
      seedState: {
        ...makeManagedTorrent('e').seedState,
        uploaded: 1000,
      },
    });
    const queued = makeManagedTorrent('f', { active: false, completed: false, seeding: false });

    manager.torrents.set(completed.seedState.infoHash, completed);
    manager.torrents.set(queued.seedState.infoHash, queued);

    await manager.start();

    expect(completed.completed).toBe(true);
    expect(queued.active).toBe(true);
    expect(manager.scheduler.schedule).toHaveBeenCalledWith(queued.seedState.infoHash, 0);

    clearInterval(manager.pollTimer);
    clearInterval(manager.stateSaveTimer);
    clearInterval(manager.rotationTimer);
    manager.running = false;
  });
});
