import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a unique temp directory for each test run
const TEST_DATA_DIR = join(tmpdir(), `seedr-test-config-${Date.now()}`);
const TEST_CLIENTS_DIR = join(TEST_DATA_DIR, 'clients');
const TEST_TORRENTS_DIR = join(TEST_DATA_DIR, 'torrents');

// Set env vars BEFORE importing the module
process.env['SEEDR_DATA_DIR'] = TEST_DATA_DIR;
process.env['SEEDR_CLIENTS_DIR'] = TEST_CLIENTS_DIR;
process.env['SEEDR_TORRENTS_DIR'] = TEST_TORRENTS_DIR;

// Dynamic import to pick up env vars
const {
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  listClientFiles,
} = await import('../src/config/config.js');

describe('Config', () => {
  beforeEach(() => {
    // Clean and recreate test dirs
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_CLIENTS_DIR, { recursive: true });
    mkdirSync(TEST_TORRENTS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('loadConfig', () => {
    it('should create default config when none exists', () => {
      const config = loadConfig();

      expect(config.port).toBe(0);
      expect(config.minUploadRate).toBe(100);
      expect(config.maxUploadRate).toBe(500);
      expect(config.simultaneousSeed).toBe(10);
      expect(config.keepTorrentWithZeroLeechers).toBe(true);
      expect(config.skipIfNoPeers).toBe(true);
      expect(config.minLeechers).toBe(0);
      expect(config.uploadRatioTarget).toBe(-1);
    });

    it('should load existing valid config', () => {
      const customConfig = {
        client: 'test-client.client',
        port: 12345,
        minUploadRate: 50,
        maxUploadRate: 200,
        simultaneousSeed: 5,
        keepTorrentWithZeroLeechers: false,
        skipIfNoPeers: false,
        minLeechers: 2,
        uploadRatioTarget: 1.5,
      };

      writeFileSync(join(TEST_DATA_DIR, 'config.json'), JSON.stringify(customConfig));

      const config = loadConfig();
      expect(config.port).toBe(12345);
      expect(config.minUploadRate).toBe(50);
      expect(config.maxUploadRate).toBe(200);
      expect(config.simultaneousSeed).toBe(5);
      expect(config.keepTorrentWithZeroLeechers).toBe(false);
      expect(config.minLeechers).toBe(2);
      expect(config.uploadRatioTarget).toBe(1.5);
    });

    it('should fall back to defaults on invalid config', () => {
      writeFileSync(
        join(TEST_DATA_DIR, 'config.json'),
        JSON.stringify({ port: 'not-a-number', minUploadRate: -999 })
      );

      const config = loadConfig();
      // Should return defaults since config is invalid (missing client)
      expect(config.port).toBe(0);
      expect(config.minUploadRate).toBe(100);
    });

    it('should fall back to defaults on malformed JSON', () => {
      writeFileSync(join(TEST_DATA_DIR, 'config.json'), 'this is not json{{{');

      // Should not throw, should return defaults
      expect(() => loadConfig()).not.toThrow();
    });
  });

  describe('saveConfig', () => {
    it('should persist config to disk', () => {
      const config = {
        client: 'test.client',
        port: 8080,
        minUploadRate: 100,
        maxUploadRate: 500,
        simultaneousSeed: 10,
        keepTorrentWithZeroLeechers: true,
        skipIfNoPeers: true,
        minLeechers: 0,
        uploadRatioTarget: -1,
      };

      saveConfig(config);

      const raw = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'config.json'), 'utf-8'));
      expect(raw.port).toBe(8080);
      expect(raw.client).toBe('test.client');
    });
  });

  describe('loadState', () => {
    it('should return empty state when no file exists', () => {
      const state = loadState();
      expect(state.torrents).toEqual({});
      expect(state.lastSaved).toBeGreaterThan(0);
    });

    it('should load valid state file', () => {
      const stateData = {
        torrents: {
          abc123: {
            infoHash: 'abc123',
            uploaded: 50000,
            downloaded: 0,
            lastAnnounce: 1000000,
            announceCount: 5,
          },
        },
        lastSaved: 1000000,
      };

      writeFileSync(join(TEST_DATA_DIR, 'state.json'), JSON.stringify(stateData));

      const state = loadState();
      expect(state.torrents['abc123']).toBeDefined();
      expect(state.torrents['abc123']!.uploaded).toBe(50000);
      expect(state.torrents['abc123']!.announceCount).toBe(5);
    });

    it('should return fresh state on corrupted file', () => {
      writeFileSync(join(TEST_DATA_DIR, 'state.json'), 'broken json');

      const state = loadState();
      expect(state.torrents).toEqual({});
    });

    it('should return fresh state on invalid schema', () => {
      writeFileSync(
        join(TEST_DATA_DIR, 'state.json'),
        JSON.stringify({ torrents: 'not-an-object', lastSaved: 'not-a-number' })
      );

      const state = loadState();
      expect(state.torrents).toEqual({});
    });
  });

  describe('saveState', () => {
    it('should persist state and update lastSaved', () => {
      const state = { torrents: {}, lastSaved: 0 };
      saveState(state);

      expect(state.lastSaved).toBeGreaterThan(0);
      const raw = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'state.json'), 'utf-8'));
      expect(raw.lastSaved).toBeGreaterThan(0);
    });
  });

  describe('listClientFiles', () => {
    it('should list .client files sorted alphabetically', () => {
      writeFileSync(join(TEST_CLIENTS_DIR, 'qbittorrent-5.1.4.client'), '{}');
      writeFileSync(join(TEST_CLIENTS_DIR, 'deluge-2.1.1.client'), '{}');
      writeFileSync(join(TEST_CLIENTS_DIR, 'notaclient.txt'), '{}');

      const files = listClientFiles();
      expect(files).toEqual(['deluge-2.1.1.client', 'qbittorrent-5.1.4.client']);
    });

    it('should return empty array when no clients exist', () => {
      // Remove client dir contents
      const files = readdirSync(TEST_CLIENTS_DIR);
      for (const f of files) rmSync(join(TEST_CLIENTS_DIR, f));

      const clients = listClientFiles();
      expect(clients).toEqual([]);
    });
  });
});
