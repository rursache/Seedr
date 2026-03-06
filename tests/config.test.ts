import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use a unique temp directory for each test run
const TEST_DATA_DIR = join(tmpdir(), `seedr-test-config-${Date.now()}`);
const TEST_CLIENTS_DIR = join(TEST_DATA_DIR, 'clients');
const TEST_TORRENTS_DIR = join(TEST_DATA_DIR, 'torrents');

// Set env vars BEFORE importing the module
process.env['DATA_DIR'] = TEST_DATA_DIR;
process.env['CLIENTS_DIR'] = TEST_CLIENTS_DIR;
process.env['TORRENTS_DIR'] = TEST_TORRENTS_DIR;

// Dynamic import to pick up env vars
const {
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  listClientFiles,
  validateConfigUpdate,
} = await import('../src/config/config.js');

/** A full valid config object for reuse in tests */
function fullConfig(overrides: Record<string, unknown> = {}) {
  return {
    client: 'test-client.client',
    port: 12345,
    minUploadRate: 50,
    maxUploadRate: 200,
    simultaneousSeed: 5,
    seedRotationInterval: 10,
    keepTorrentWithZeroLeechers: false,
    skipIfNoPeers: false,
    minLeechers: 2,
    minSeeders: 1,
    uploadRatioTarget: 1.5,
    showFileName: false,
    ...overrides,
  };
}

function writeConfig(data: unknown) {
  writeFileSync(join(TEST_DATA_DIR, 'config.json'), JSON.stringify(data));
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TEST_DATA_DIR, 'config.json'), 'utf-8'));
}

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

      expect(config.port).toBe(49152);
      expect(config.minUploadRate).toBe(100);
      expect(config.maxUploadRate).toBe(500);
      expect(config.simultaneousSeed).toBe(-1);
      expect(config.seedRotationInterval).toBe(15);
      expect(config.keepTorrentWithZeroLeechers).toBe(true);
      expect(config.skipIfNoPeers).toBe(true);
      expect(config.minLeechers).toBe(1);
      expect(config.minSeeders).toBe(1);
      expect(config.uploadRatioTarget).toBe(-1);
      expect(config.showFileName).toBe(true);
    });

    it('should write the default config to disk', () => {
      loadConfig();
      const raw = readConfig();
      expect(raw.port).toBe(49152);
      expect(raw.seedRotationInterval).toBe(15);
      expect(raw.showFileName).toBe(true);
    });

    it('should load existing valid config', () => {
      writeConfig(fullConfig());

      const config = loadConfig();
      expect(config.port).toBe(12345);
      expect(config.minUploadRate).toBe(50);
      expect(config.maxUploadRate).toBe(200);
      expect(config.simultaneousSeed).toBe(5);
      expect(config.seedRotationInterval).toBe(10);
      expect(config.keepTorrentWithZeroLeechers).toBe(false);
      expect(config.minLeechers).toBe(2);
      expect(config.minSeeders).toBe(1);
      expect(config.uploadRatioTarget).toBe(1.5);
      expect(config.showFileName).toBe(false);
    });

    it('should apply defaults for missing fields while keeping valid ones', () => {
      writeConfig({ client: 'custom.client', port: 9999 });

      const config = loadConfig();
      // Provided fields preserved
      expect(config.client).toBe('custom.client');
      expect(config.port).toBe(9999);
      // Missing fields get defaults
      expect(config.minUploadRate).toBe(100);
      expect(config.maxUploadRate).toBe(500);
      expect(config.simultaneousSeed).toBe(-1);
      expect(config.seedRotationInterval).toBe(15);
      expect(config.showFileName).toBe(true);
    });

    it('should repair only invalid fields and keep valid ones', () => {
      writeConfig({
        client: 'my-client.client',
        port: 'not-a-number',       // invalid
        minUploadRate: 200,          // valid
        maxUploadRate: -5,           // invalid (< 0)
        simultaneousSeed: 3,         // valid
        seedRotationInterval: 0,     // invalid (< 1)
        minLeechers: 4,              // valid
      });

      const config = loadConfig();
      // Valid fields preserved
      expect(config.client).toBe('my-client.client');
      expect(config.minUploadRate).toBe(200);
      expect(config.simultaneousSeed).toBe(3);
      expect(config.minLeechers).toBe(4);
      // Invalid fields replaced with defaults
      expect(config.port).toBe(49152);
      expect(config.maxUploadRate).toBe(500);
      expect(config.seedRotationInterval).toBe(15);
    });

    it('should save repaired config back to disk', () => {
      writeConfig({ client: 'keep-me.client', port: -1 });

      loadConfig();
      const raw = readConfig();
      expect(raw.client).toBe('keep-me.client');
      expect(raw.port).toBe(49152); // repaired
      expect(raw.seedRotationInterval).toBe(15); // filled default
    });

    it('should repair port=0 to default', () => {
      writeConfig(fullConfig({ port: 0 }));
      const config = loadConfig();
      expect(config.port).toBe(49152);
    });

    it('should repair port > 65535', () => {
      writeConfig(fullConfig({ port: 99999 }));
      const config = loadConfig();
      expect(config.port).toBe(49152);
    });

    it('should repair simultaneousSeed=0', () => {
      writeConfig(fullConfig({ simultaneousSeed: 0 }));
      const config = loadConfig();
      expect(config.simultaneousSeed).toBe(-1);
    });

    it('should repair seedRotationInterval=0', () => {
      writeConfig(fullConfig({ seedRotationInterval: 0 }));
      const config = loadConfig();
      expect(config.seedRotationInterval).toBe(15);
    });

    it('should repair seedRotationInterval > 999999', () => {
      writeConfig(fullConfig({ seedRotationInterval: 1000000 }));
      const config = loadConfig();
      expect(config.seedRotationInterval).toBe(15);
    });

    it('should repair negative minLeechers', () => {
      writeConfig(fullConfig({ minLeechers: -1 }));
      const config = loadConfig();
      expect(config.minLeechers).toBe(1);
    });

    it('should repair non-boolean showFileName', () => {
      writeConfig(fullConfig({ showFileName: 'yes' }));
      const config = loadConfig();
      expect(config.showFileName).toBe(true);
    });

    it('should fall back to full defaults on malformed JSON', () => {
      writeFileSync(join(TEST_DATA_DIR, 'config.json'), 'this is not json{{{');
      expect(() => loadConfig()).not.toThrow();
      const config = loadConfig();
      expect(config.port).toBe(49152);
    });

    it('should fall back to full defaults on non-object JSON', () => {
      writeConfig([1, 2, 3]);
      const config = loadConfig();
      expect(config.port).toBe(49152);
    });

    it('should fall back to full defaults on null JSON', () => {
      writeConfig(null);
      const config = loadConfig();
      expect(config.port).toBe(49152);
    });

    it('should strip unknown keys during repair', () => {
      writeConfig(fullConfig({ unknownKey: 'hello', anotherBad: 42 }));
      const config = loadConfig();
      expect(config).not.toHaveProperty('unknownKey');
      expect(config).not.toHaveProperty('anotherBad');
    });
  });

  describe('saveConfig', () => {
    it('should persist config to disk', () => {
      const config = fullConfig();
      saveConfig(config);

      const raw = readConfig();
      expect(raw.port).toBe(12345);
      expect(raw.client).toBe('test-client.client');
      expect(raw.seedRotationInterval).toBe(10);
      expect(raw.showFileName).toBe(false);
    });

    it('should roundtrip through save and load', () => {
      const config = fullConfig();
      saveConfig(config);
      const loaded = loadConfig();
      expect(loaded).toEqual(config);
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

  describe('validateConfigUpdate', () => {
    it('should accept valid partial updates', () => {
      const result = validateConfigUpdate({ port: 8080, minUploadRate: 200 });
      expect(result).toEqual({ port: 8080, minUploadRate: 200 });
    });

    it('should accept a single field update', () => {
      const result = validateConfigUpdate({ maxUploadRate: 1000 });
      expect(result).toEqual({ maxUploadRate: 1000 });
    });

    it('should accept empty object', () => {
      const result = validateConfigUpdate({});
      expect(result).toEqual({});
    });

    // Port validation
    it('should reject port=0', () => {
      expect(() => validateConfigUpdate({ port: 0 })).toThrow();
    });

    it('should reject port > 65535', () => {
      expect(() => validateConfigUpdate({ port: 99999 })).toThrow();
    });

    it('should reject non-integer port', () => {
      expect(() => validateConfigUpdate({ port: 80.5 })).toThrow();
    });

    it('should accept valid port', () => {
      expect(validateConfigUpdate({ port: 1 })).toEqual({ port: 1 });
      expect(validateConfigUpdate({ port: 65535 })).toEqual({ port: 65535 });
    });

    // simultaneousSeed validation
    it('should reject simultaneousSeed=0', () => {
      expect(() => validateConfigUpdate({ simultaneousSeed: 0 })).toThrow('Must be -1 (unlimited) or >= 1');
    });

    it('should allow simultaneousSeed=-1', () => {
      const result = validateConfigUpdate({ simultaneousSeed: -1 });
      expect(result).toEqual({ simultaneousSeed: -1 });
    });

    it('should allow simultaneousSeed=1', () => {
      const result = validateConfigUpdate({ simultaneousSeed: 1 });
      expect(result).toEqual({ simultaneousSeed: 1 });
    });

    it('should reject simultaneousSeed < -1', () => {
      expect(() => validateConfigUpdate({ simultaneousSeed: -2 })).toThrow();
    });

    // seedRotationInterval validation
    it('should reject seedRotationInterval=0', () => {
      expect(() => validateConfigUpdate({ seedRotationInterval: 0 })).toThrow();
    });

    it('should reject seedRotationInterval=-1', () => {
      expect(() => validateConfigUpdate({ seedRotationInterval: -1 })).toThrow();
    });

    it('should reject seedRotationInterval > 999999', () => {
      expect(() => validateConfigUpdate({ seedRotationInterval: 1000000 })).toThrow();
    });

    it('should accept seedRotationInterval=1', () => {
      expect(validateConfigUpdate({ seedRotationInterval: 1 })).toEqual({ seedRotationInterval: 1 });
    });

    it('should accept seedRotationInterval=999999', () => {
      expect(validateConfigUpdate({ seedRotationInterval: 999999 })).toEqual({ seedRotationInterval: 999999 });
    });

    // Upload rate validation
    it('should reject negative upload rates', () => {
      expect(() => validateConfigUpdate({ minUploadRate: -5 })).toThrow();
      expect(() => validateConfigUpdate({ maxUploadRate: -1 })).toThrow();
    });

    it('should accept zero upload rates', () => {
      expect(validateConfigUpdate({ minUploadRate: 0 })).toEqual({ minUploadRate: 0 });
    });

    // Peer count validation
    it('should reject negative minLeechers', () => {
      expect(() => validateConfigUpdate({ minLeechers: -1 })).toThrow();
    });

    it('should reject negative minSeeders', () => {
      expect(() => validateConfigUpdate({ minSeeders: -1 })).toThrow();
    });

    it('should accept zero peer counts', () => {
      expect(validateConfigUpdate({ minLeechers: 0, minSeeders: 0 })).toEqual({ minLeechers: 0, minSeeders: 0 });
    });

    // Boolean validation
    it('should reject non-boolean for boolean fields', () => {
      expect(() => validateConfigUpdate({ showFileName: 'yes' as any })).toThrow();
      expect(() => validateConfigUpdate({ keepTorrentWithZeroLeechers: 1 as any })).toThrow();
      expect(() => validateConfigUpdate({ skipIfNoPeers: 0 as any })).toThrow();
    });

    it('should accept boolean values', () => {
      expect(validateConfigUpdate({ showFileName: false })).toEqual({ showFileName: false });
      expect(validateConfigUpdate({ keepTorrentWithZeroLeechers: true })).toEqual({ keepTorrentWithZeroLeechers: true });
    });

    // Type validation
    it('should reject invalid types', () => {
      expect(() => validateConfigUpdate({ port: 'not-a-number' })).toThrow();
    });

    it('should filter out unknown keys', () => {
      const result = validateConfigUpdate({ port: 8080, unknownKey: 'foo', anotherBad: 123 } as any);
      expect(result).toEqual({ port: 8080 });
      expect(result).not.toHaveProperty('unknownKey');
      expect(result).not.toHaveProperty('anotherBad');
    });

    it('should format multiple validation errors', () => {
      expect(() => validateConfigUpdate({ port: 'bad', minUploadRate: -5 } as any)).toThrow(/port/);
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
