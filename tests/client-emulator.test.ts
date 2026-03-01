import { describe, it, expect } from 'vitest';
import {
  generateKey,
  generatePeerId,
  buildAnnounceQuery,
  shouldRefreshKey,
  shouldRefreshPeerId,
  loadClientProfile,
  type EmulatorState,
} from '../src/core/client-emulator.js';
import type {
  KeyGenerator,
  PeerIdGenerator,
  ClientProfile,
} from '../src/config/types.js';
import { join } from 'node:path';

const CLIENTS_DIR = join(import.meta.dirname, '..', 'clients');

describe('key generation', () => {
  it('HASH: generates hex string of correct length', () => {
    const gen: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'NEVER',
      keyCase: 'upper',
    };

    const key = generateKey(gen);
    expect(key).toMatch(/^[0-9A-F]{8}$/);
  });

  it('HASH_NO_LEADING_ZERO: never starts with 0', () => {
    const gen: KeyGenerator = {
      algorithm: { type: 'HASH_NO_LEADING_ZERO', length: 8 },
      refreshOn: 'NEVER',
      keyCase: 'upper',
    };

    for (let i = 0; i < 50; i++) {
      const key = generateKey(gen);
      expect(key[0]).not.toBe('0');
      expect(key).toHaveLength(8);
    }
  });

  it('DIGIT_RANGE_TRANSFORMED_TO_HEX: generates valid hex in range', () => {
    const gen: KeyGenerator = {
      algorithm: {
        type: 'DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES',
        inclusiveLowerBound: 1,
        inclusiveUpperBound: 2147483647,
      },
      refreshOn: 'NEVER',
      keyCase: 'lower',
    };

    const key = generateKey(gen);
    const num = parseInt(key, 16);
    expect(num).toBeGreaterThanOrEqual(1);
    expect(num).toBeLessThanOrEqual(2147483647);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('respects keyCase setting', () => {
    const genUpper: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'NEVER',
      keyCase: 'upper',
    };
    const genLower: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'NEVER',
      keyCase: 'lower',
    };

    expect(generateKey(genUpper)).toMatch(/^[0-9A-F]+$/);
    expect(generateKey(genLower)).toMatch(/^[0-9a-f]+$/);
  });
});

describe('peer ID generation', () => {
  it('REGEX: generates peer ID matching pattern', () => {
    const gen: PeerIdGenerator = {
      algorithm: {
        type: 'REGEX',
        pattern: '-qB5140-[A-Za-z0-9_~\\(\\)\\!\\.\\*-]{12}',
      },
      refreshOn: 'NEVER',
      shouldUrlEncode: false,
    };

    const peerId = generatePeerId(gen);
    expect(peerId.length).toBe(20);
    // Check prefix
    const prefix = peerId.subarray(0, 8).toString('ascii');
    expect(prefix).toBe('-qB5140-');
  });

  it('RANDOM_POOL_WITH_CHECKSUM: generates Transmission-style peer ID', () => {
    const gen: PeerIdGenerator = {
      algorithm: {
        type: 'RANDOM_POOL_WITH_CHECKSUM',
        prefix: '-TR3000-',
        charactersPool: '0123456789abcdefghijklmnopqrstuvwxyz',
        base: 36,
      },
      refreshOn: 'TORRENT_VOLATILE',
      shouldUrlEncode: false,
    };

    const peerId = generatePeerId(gen);
    expect(peerId.length).toBe(20);

    const str = peerId.toString('ascii');
    expect(str.startsWith('-TR3000-')).toBe(true);

    // All chars after prefix should be from the pool
    const pool = '0123456789abcdefghijklmnopqrstuvwxyz';
    for (let i = 8; i < 20; i++) {
      expect(pool).toContain(str[i]);
    }
  });
});

describe('key refresh logic', () => {
  const state: EmulatorState = {
    peerId: Buffer.alloc(20),
    key: 'ABCD1234',
    announceCount: 10,
    startedAnnouncesSent: 1,
    lastKeyRefresh: Date.now(),
  };

  it('NEVER: does not refresh', () => {
    const gen: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'NEVER',
      keyCase: 'upper',
    };
    expect(shouldRefreshKey(gen, state, '')).toBe(false);
    expect(shouldRefreshKey(gen, state, 'started')).toBe(false);
  });

  it('ALWAYS: always refreshes', () => {
    const gen: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'ALWAYS',
      keyCase: 'upper',
    };
    expect(shouldRefreshKey(gen, state, '')).toBe(true);
  });

  it('TIMED_OR_AFTER_STARTED_ANNOUNCE: refreshes on started event', () => {
    const gen: KeyGenerator = {
      algorithm: { type: 'HASH', length: 8 },
      refreshOn: 'TIMED_OR_AFTER_STARTED_ANNOUNCE',
      refreshEvery: 10,
      keyCase: 'upper',
    };
    expect(shouldRefreshKey(gen, state, 'started')).toBe(true);
    expect(shouldRefreshKey(gen, { ...state, announceCount: 10 }, '')).toBe(true);
    expect(shouldRefreshKey(gen, { ...state, announceCount: 5 }, '')).toBe(false);
  });
});

describe('query building', () => {
  it('builds correct query string for qBittorrent profile', () => {
    const profile = loadClientProfile(join(CLIENTS_DIR, 'qbittorrent-5.1.4.client'));

    const params = {
      infoHash: Buffer.from('01234567890123456789'),
      peerId: Buffer.from('-qB5140-abcdefghijkl'),
      port: 51234,
      uploaded: 1000000,
      downloaded: 0,
      left: 0,
      event: '' as const,
      numwant: 200,
      key: 'A1B2C3D4',
    };

    const query = buildAnnounceQuery(profile, params, '');

    expect(query).toContain('info_hash=');
    expect(query).toContain('peer_id=');
    expect(query).toContain('port=51234');
    expect(query).toContain('uploaded=1000000');
    expect(query).toContain('downloaded=0');
    expect(query).toContain('left=0');
    expect(query).toContain('key=A1B2C3D4');
    expect(query).toContain('compact=1');
    expect(query).toContain('numwant=200');
    // Should NOT contain event= when event is empty
    expect(query).not.toMatch(/event=[^&]/);
  });

  it('includes event on started announce', () => {
    const profile = loadClientProfile(join(CLIENTS_DIR, 'qbittorrent-5.1.4.client'));

    const params = {
      infoHash: Buffer.from('01234567890123456789'),
      peerId: Buffer.from('-qB5140-abcdefghijkl'),
      port: 51234,
      uploaded: 0,
      downloaded: 0,
      left: 0,
      event: 'started' as const,
      numwant: 200,
      key: 'A1B2C3D4',
    };

    const query = buildAnnounceQuery(profile, params, 'started');
    expect(query).toContain('event=started');
  });
});

describe('client profile loading', () => {
  it('loads all client profiles without error', () => {
    const clientFiles = [
      'qbittorrent-5.1.4.client',
      'bittorrent-7.10.3_44429.client',
      'deluge-2.1.1.client',
      'transmission-3.00.client',
      'utorrent-3.5.4_44498.client',
    ];

    for (const file of clientFiles) {
      const profile = loadClientProfile(join(CLIENTS_DIR, file));
      expect(profile.query).toBeTruthy();
      expect(profile.numwant).toBeGreaterThan(0);
      expect(profile.requestHeaders.length).toBeGreaterThan(0);
      expect(profile.keyGenerator).toBeTruthy();
      expect(profile.peerIdGenerator).toBeTruthy();
      expect(profile.urlEncoder).toBeTruthy();
    }
  });
});
