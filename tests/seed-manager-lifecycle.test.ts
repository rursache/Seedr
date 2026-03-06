import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as configModule from '../src/config/config.js';
import * as clientEmulatorModule from '../src/core/client-emulator.js';
import * as torrentParserModule from '../src/core/torrent-parser.js';
import { SeedManager } from '../src/core/seed-manager.js';
import type { AppConfig, TorrentRuntimeState } from '../src/config/types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    client: 'test.client',
    port: 49152,
    minUploadRate: 100,
    maxUploadRate: 500,
    simultaneousSeed: -1,
    seedRotationInterval: 15,
    keepTorrentWithZeroLeechers: true,
    skipIfNoPeers: true,
    minLeechers: 1,
    minSeeders: 1,
    uploadRatioTarget: -1,
    showFileName: true,
    ...overrides,
  };
}

function makeTorrent(id: string, overrides: Partial<TorrentRuntimeState> = {}): TorrentRuntimeState {
  const infoHash = id.repeat(40).slice(0, 40);
  return {
    meta: {
      infoHash: Buffer.from(infoHash, 'hex'),
      name: `torrent-${id}`,
      totalSize: 1000,
      files: [],
      trackers: ['http://tracker.example.com/announce'],
      pieceLength: 262144,
      isPrivate: false,
      filePath: `/tmp/${id}.torrent`,
    },
    seedState: {
      infoHash,
      uploaded: 0,
      downloaded: 0,
      lastAnnounce: 0,
      announceCount: 0,
    },
    peerId: Buffer.alloc(20),
    key: 'old-key',
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
    lastFailureTransient: false,
    ...overrides,
  };
}

function createManager(overrides: Partial<AppConfig> = {}) {
  const manager = new SeedManager(true) as any;
  manager.config = makeConfig(overrides);
  manager.state = { torrents: {}, lastSaved: 0 };
  manager.profile = {
    keyGenerator: { algorithm: { type: 'HASH', length: 8 }, refreshOn: 'NEVER', keyCase: 'upper' },
    peerIdGenerator: { algorithm: { type: 'REGEX', pattern: '-UT0001-[A-Za-z0-9]{12}' }, refreshOn: 'NEVER', shouldUrlEncode: false },
  };
  manager.torrents = new Map();
  manager.emulatorStates = new Map();
  manager.announceLocks = new Map();
  manager.activatedAt = new Map();
  manager.bandwidth = {
    registerTorrent: vi.fn(),
    updateTorrent: vi.fn(),
    updateRates: vi.fn(),
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
    port: manager.config.port,
    externalIp: null,
    externalIpv6: null,
  };
  manager.runPortCheck = vi.fn();
  return manager;
}

describe('SeedManager lifecycle and config updates', () => {
  const createdFiles: string[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    for (const file of createdFiles.splice(0)) {
      rmSync(file, { force: true });
    }
  });

  it('restarts the connection handler when port changes while running', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const manager = createManager({ port: 49152 });
    manager.running = true;

    await manager.updateConfig({ port: 50000 });

    expect(manager.connection.stop).toHaveBeenCalledOnce();
    expect(manager.connection.start).toHaveBeenCalledWith(50000);
    expect(manager.connection.setContext).toHaveBeenCalledOnce();
    expect(manager.runPortCheck).toHaveBeenCalledOnce();
    saveSpy.mockRestore();
  });

  it('rolls back the live connection and keeps config unchanged if port restart fails', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const manager = createManager({ port: 49152 });
    manager.running = true;
    manager.connection.start = vi
      .fn()
      .mockRejectedValueOnce(new Error('bind failed'))
      .mockResolvedValueOnce(undefined);

    await expect(manager.updateConfig({ port: 50000 })).rejects.toThrow('bind failed');

    expect(manager.config.port).toBe(49152);
    expect(manager.connection.stop).toHaveBeenCalledOnce();
    expect(manager.connection.start).toHaveBeenNthCalledWith(1, 50000);
    expect(manager.connection.start).toHaveBeenNthCalledWith(2, 49152);
    expect(manager.connection.setContext).toHaveBeenCalledOnce();
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('reloads the client profile and regenerates peer IDs and keys on client change', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const loadSpy = vi.spyOn(clientEmulatorModule, 'loadClientProfile').mockReturnValue({
      keyGenerator: { algorithm: { type: 'HASH', length: 8 }, refreshOn: 'NEVER', keyCase: 'upper' },
      peerIdGenerator: { algorithm: { type: 'REGEX', pattern: '-TR3000-[A-Za-z0-9]{12}' }, refreshOn: 'NEVER', shouldUrlEncode: false },
      urlEncoder: { encodingExclusionPattern: '[A-Za-z0-9]', encodedHexCase: 'upper' },
      query: '',
      numwant: 200,
      numwantOnStop: 0,
      requestHeaders: [],
    } as any);
    const peerSpy = vi.spyOn(clientEmulatorModule, 'generatePeerId').mockReturnValue(Buffer.from('new-peer-id-12345678'));
    const keySpy = vi.spyOn(clientEmulatorModule, 'generateKey').mockReturnValue('NEWKEY12');

    mkdirSync(configModule.CLIENTS_DIR, { recursive: true });
    const filePath = join(configModule.CLIENTS_DIR, 'test-switch.client');
    writeFileSync(filePath, '{}');
    createdFiles.push(filePath);

    const manager = createManager();
    const torrent = makeTorrent('a');
    manager.torrents.set(torrent.seedState.infoHash, torrent);
    manager.emulatorStates.set(torrent.seedState.infoHash, {
      peerId: Buffer.from('old-peer-id-12345678'),
      key: 'OLDKEY12',
      announceCount: 0,
      startedAnnouncesSent: 0,
      lastKeyRefresh: 0,
    });

    await manager.updateConfig({ client: 'test-switch.client' });

    expect(loadSpy).toHaveBeenCalledOnce();
    expect(peerSpy).toHaveBeenCalledOnce();
    expect(keySpy).toHaveBeenCalledOnce();
    expect(torrent.peerId.equals(Buffer.from('new-peer-id-12345678'))).toBe(true);
    expect(torrent.key).toBe('NEWKEY12');
    saveSpy.mockRestore();
  });

  it('keeps config and runtime state unchanged if client profile loading fails', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const loadSpy = vi.spyOn(clientEmulatorModule, 'loadClientProfile').mockImplementation(() => {
      throw new Error('invalid profile');
    });
    const originalConfig = makeConfig();

    mkdirSync(configModule.CLIENTS_DIR, { recursive: true });
    const filePath = join(configModule.CLIENTS_DIR, 'broken.client');
    writeFileSync(filePath, '{}');
    createdFiles.push(filePath);

    const manager = createManager();
    const torrent = makeTorrent('a');
    manager.torrents.set(torrent.seedState.infoHash, torrent);
    manager.emulatorStates.set(torrent.seedState.infoHash, {
      peerId: Buffer.from('old-peer-id-12345678'),
      key: 'OLDKEY12',
      announceCount: 0,
      startedAnnouncesSent: 0,
      lastKeyRefresh: 0,
    });

    await expect(manager.updateConfig({ client: 'broken.client' })).rejects.toThrow('invalid profile');

    expect(loadSpy).toHaveBeenCalledOnce();
    expect(manager.config).toEqual(originalConfig);
    expect(torrent.key).toBe('old-key');
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('updates bandwidth rates when upload rate bounds change', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const manager = createManager();

    await manager.updateConfig({ minUploadRate: 50, maxUploadRate: 250 });

    expect(manager.bandwidth.updateRates).toHaveBeenCalledWith(50, 250);
    saveSpy.mockRestore();
  });

  it('recomputes eligibility for all torrents when peer thresholds change', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const manager = createManager({ minLeechers: 1 });
    const eligible = makeTorrent('a', { leechers: 3, seeders: 2 });
    const ineligible = makeTorrent('b', { leechers: 0, seeders: 2 });
    manager.torrents.set(eligible.seedState.infoHash, eligible);
    manager.torrents.set(ineligible.seedState.infoHash, ineligible);

    await manager.updateConfig({ keepTorrentWithZeroLeechers: false });

    expect(manager.bandwidth.updateTorrent).toHaveBeenCalledWith(eligible.seedState.infoHash, { eligible: true });
    expect(manager.bandwidth.updateTorrent).toHaveBeenCalledWith(ineligible.seedState.infoHash, { eligible: false });
    saveSpy.mockRestore();
  });

  it('rebalances active slots and restarts rotation timer when simultaneousSeed changes while running', async () => {
    const saveSpy = vi.spyOn(configModule, 'saveConfig').mockImplementation(() => {});
    const manager = createManager({ simultaneousSeed: -1, seedRotationInterval: 15 });
    manager.running = true;
    manager.rebalanceActiveTorrents = vi.fn();
    manager.startRotationTimer = vi.fn();

    await manager.updateConfig({ simultaneousSeed: 2 });

    expect(manager.rebalanceActiveTorrents).toHaveBeenCalledOnce();
    expect(manager.startRotationTimer).toHaveBeenCalledOnce();
    saveSpy.mockRestore();
  });

  it('scans the torrents directory and loads only .torrent files', () => {
    mkdirSync(configModule.TORRENTS_DIR, { recursive: true });
    const torrentPath = join(configModule.TORRENTS_DIR, 'scan-test.torrent');
    const ignoredPath = join(configModule.TORRENTS_DIR, 'scan-test.txt');
    writeFileSync(torrentPath, 'dummy');
    writeFileSync(ignoredPath, 'ignore');
    createdFiles.push(torrentPath, ignoredPath);

    const parseSpy = vi.spyOn(torrentParserModule, 'parseTorrentFile').mockImplementation((filePath) => ({
      infoHash: Buffer.from('1'.repeat(40), 'hex'),
      name: 'scan-test',
      totalSize: 1000,
      files: [],
      trackers: ['http://tracker.example.com/announce'],
      pieceLength: 262144,
      isPrivate: false,
      filePath,
    }));

    const manager = createManager();
    manager.scanTorrents();

    expect(parseSpy).toHaveBeenCalledWith(torrentPath);
    expect(parseSpy).not.toHaveBeenCalledWith(ignoredPath);
    expect(manager.torrents.size).toBeGreaterThanOrEqual(1);
  });

  it('cleans up partial startup state when connection startup fails', async () => {
    const manager = createManager();
    const torrent = makeTorrent('a', { active: true });
    manager.torrents.set(torrent.seedState.infoHash, torrent);
    manager.connection.start = vi.fn(async () => {
      throw new Error('listen failed');
    });

    await expect(manager.start()).rejects.toThrow('listen failed');

    expect(manager.running).toBe(false);
    expect(manager.pollTimer).toBeNull();
    expect(manager.stateSaveTimer).toBeNull();
    expect(manager.scheduler.clear).toHaveBeenCalledOnce();
    expect(manager.connection.stop).toHaveBeenCalledOnce();
    expect(manager.bandwidth.start).not.toHaveBeenCalled();
    expect(manager.activatedAt.size).toBe(0);
  });
});
