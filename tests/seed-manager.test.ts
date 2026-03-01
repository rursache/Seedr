import { describe, it, expect } from 'vitest';
import { checkTorrentEligible, checkRatioTarget } from '../src/core/seed-manager.js';
import type { AppConfig, TorrentRuntimeState } from '../src/config/types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    client: 'test.client',
    port: 0,
    minUploadRate: 100,
    maxUploadRate: 500,
    simultaneousSeed: -1,
    keepTorrentWithZeroLeechers: true,
    skipIfNoPeers: true,
    minLeechers: 0,
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
