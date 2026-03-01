import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AnnounceResponse,
  ClientProfile,
  TorrentMeta,
  TorrentSeedState,
} from '../src/config/types.js';
import type { EmulatorState } from '../src/core/client-emulator.js';

// Mock the tracker client and client-emulator
vi.mock('../src/core/tracker/tracker-client.js', () => ({
  announce: vi.fn(),
}));

vi.mock('../src/core/client-emulator.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    shouldRefreshKey: vi.fn(() => false),
    shouldRefreshPeerId: vi.fn(() => false),
    generateKey: vi.fn(() => 'newkey'),
    generatePeerId: vi.fn(() => Buffer.from('newpeerid12345678901')),
  };
});

import { performAnnounce } from '../src/core/announcer.js';
import { announce as mockAnnounce } from '../src/core/tracker/tracker-client.js';
import { shouldRefreshKey, shouldRefreshPeerId } from '../src/core/client-emulator.js';

const mockedAnnounce = vi.mocked(mockAnnounce);

function makeMeta(trackers: string[] = ['http://tracker1.example.com/announce']): TorrentMeta {
  return {
    infoHash: Buffer.from('01234567890123456789'),
    name: 'test-torrent',
    totalSize: 1024 * 1024,
    pieceLength: 262144,
    pieces: Buffer.alloc(20),
    files: [{ path: 'test.txt', size: 1024 * 1024 }],
    trackers,
    isPrivate: false,
    filePath: '/tmp/test.torrent',
  };
}

function makeSeedState(): TorrentSeedState {
  return {
    infoHash: '3031323334353637383930313233343536373839',
    uploaded: 5000,
    downloaded: 0,
    lastAnnounce: 0,
    announceCount: 0,
  };
}

function makeEmulatorState(): EmulatorState {
  return {
    peerId: Buffer.from('-qB5140-aabbccddeeff'),
    key: 'AABB1122',
    announceCount: 0,
    startedAnnouncesSent: 0,
    lastKeyRefresh: Date.now(),
  };
}

function makeProfile(): ClientProfile {
  return {
    name: 'qBittorrent 5.1.4',
    version: '5.1.4',
    keyGenerator: { algorithm: 'HASH', length: 8, refreshOn: 'NEVER' } as any,
    peerIdGenerator: { algorithm: 'REGEX', pattern: '-qB5140-[A-Za-z0-9]{12}', refreshOn: 'NEVER' } as any,
    urlEncoder: { encodingExclusionPattern: '[A-Za-z0-9~]', encodedHexCase: 'upper' },
    query: '?info_hash={infohash}&peer_id={peerid}&port={port}&uploaded={uploaded}&downloaded={downloaded}&left={left}&event={event}&numwant={numwant}&compact=1&no_peer_id=1',
    numwant: 200,
    numwantOnStop: 0,
    requestHeaders: [{ name: 'User-Agent', value: 'qBittorrent/5.1.4' }],
  };
}

function successResponse(overrides: Partial<AnnounceResponse> = {}): AnnounceResponse {
  return {
    interval: 1800,
    seeders: 10,
    leechers: 5,
    peers: [],
    ...overrides,
  };
}

describe('Announcer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success and update state on successful announce', async () => {
    mockedAnnounce.mockResolvedValue(successResponse());

    const seedState = makeSeedState();
    const emState = makeEmulatorState();

    const result = await performAnnounce(
      makeMeta(), seedState, emState, makeProfile(),
      'started', 12345, 0
    );

    expect(result.success).toBe(true);
    expect(result.consecutiveFailures).toBe(0);
    expect(result.response?.seeders).toBe(10);
    expect(result.response?.leechers).toBe(5);
    expect(seedState.uploaded).toBe(5000); // no delta added
    expect(seedState.announceCount).toBe(1);
    expect(emState.announceCount).toBe(1);
    expect(emState.startedAnnouncesSent).toBe(1); // started event
  });

  it('should add upload delta to uploaded total', async () => {
    mockedAnnounce.mockResolvedValue(successResponse());

    const seedState = makeSeedState();
    seedState.uploaded = 1000;
    const emState = makeEmulatorState();

    const result = await performAnnounce(
      makeMeta(), seedState, emState, makeProfile(),
      '', 12345, 5000 // 5000 byte delta
    );

    expect(result.success).toBe(true);
    expect(seedState.uploaded).toBe(6000); // 1000 + 5000
  });

  it('should not increment startedAnnouncesSent on regular announce', async () => {
    mockedAnnounce.mockResolvedValue(successResponse());

    const emState = makeEmulatorState();

    await performAnnounce(
      makeMeta(), makeSeedState(), emState, makeProfile(),
      '', 12345, 0 // regular announce (empty event)
    );

    expect(emState.startedAnnouncesSent).toBe(0);
  });

  it('should increment consecutive failures on tracker failure reason', async () => {
    mockedAnnounce.mockResolvedValue(successResponse({
      failureReason: 'Torrent not found',
    }));

    const result = await performAnnounce(
      makeMeta(), makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 0, 0
    );

    expect(result.success).toBe(false);
    expect(result.consecutiveFailures).toBe(1);
    expect(result.error).toBe('Torrent not found');
  });

  it('should increment consecutive failures on network error', async () => {
    mockedAnnounce.mockRejectedValue(new Error('Connection timeout'));

    const result = await performAnnounce(
      makeMeta(), makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 0, 2
    );

    expect(result.success).toBe(false);
    expect(result.consecutiveFailures).toBe(3);
    expect(result.error).toBe('Connection timeout');
  });

  it('should switch tracker after MAX_CONSECUTIVE_FAILURES (5)', async () => {
    mockedAnnounce.mockRejectedValue(new Error('timeout'));

    const meta = makeMeta([
      'http://tracker1.example.com/announce',
      'http://tracker2.example.com/announce',
    ]);

    // Already at 4 consecutive failures, this is the 5th
    const result = await performAnnounce(
      meta, makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 0, 4
    );

    expect(result.success).toBe(false);
    expect(result.trackerIndex).toBe(1); // Switched to second tracker
    expect(result.consecutiveFailures).toBe(0); // Reset after switch
  });

  it('should not switch tracker if only one tracker available', async () => {
    mockedAnnounce.mockRejectedValue(new Error('timeout'));

    // Only one tracker
    const result = await performAnnounce(
      makeMeta(), makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 0, 4
    );

    expect(result.trackerIndex).toBe(0); // stays at 0
    expect(result.consecutiveFailures).toBe(5); // keeps incrementing
  });

  it('should wrap around tracker index', async () => {
    mockedAnnounce.mockRejectedValue(new Error('timeout'));

    const meta = makeMeta([
      'http://tracker1.example.com/announce',
      'http://tracker2.example.com/announce',
    ]);

    // At tracker index 1 (last tracker), 4 failures, this is the 5th
    const result = await performAnnounce(
      meta, makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 1, 4
    );

    expect(result.trackerIndex).toBe(0); // Wrapped back to first
    expect(result.consecutiveFailures).toBe(0);
  });

  it('should return error when no trackers available', async () => {
    const meta = makeMeta([]);

    const result = await performAnnounce(
      meta, makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('No trackers available');
    expect(mockedAnnounce).not.toHaveBeenCalled();
  });

  it('should reset consecutive failures on success', async () => {
    mockedAnnounce.mockResolvedValue(successResponse());

    // Starting with 3 consecutive failures
    const result = await performAnnounce(
      makeMeta(), makeSeedState(), makeEmulatorState(), makeProfile(),
      '', 12345, 0, undefined, undefined, 0, 3
    );

    expect(result.success).toBe(true);
    expect(result.consecutiveFailures).toBe(0);
  });

  it('should call refresh functions for key and peerId', async () => {
    vi.mocked(shouldRefreshKey).mockReturnValue(true);
    vi.mocked(shouldRefreshPeerId).mockReturnValue(true);
    mockedAnnounce.mockResolvedValue(successResponse());

    const emState = makeEmulatorState();
    await performAnnounce(
      makeMeta(), makeSeedState(), emState, makeProfile(),
      'started', 12345, 0
    );

    expect(shouldRefreshKey).toHaveBeenCalled();
    expect(shouldRefreshPeerId).toHaveBeenCalled();
    expect(emState.key).toBe('newkey');
    expect(emState.peerId).toEqual(Buffer.from('newpeerid12345678901'));
  });

  it('should handle failureReason with tracker switch', async () => {
    mockedAnnounce.mockResolvedValue(successResponse({
      failureReason: 'Access denied',
    }));

    const meta = makeMeta([
      'http://tracker1.example.com/announce',
      'http://tracker2.example.com/announce',
    ]);

    // At 4 failures, this makes 5 — should switch tracker
    const result = await performAnnounce(
      meta, makeSeedState(), makeEmulatorState(), makeProfile(),
      'started', 12345, 0, undefined, undefined, 0, 4
    );

    expect(result.trackerIndex).toBe(1);
    expect(result.consecutiveFailures).toBe(0);
  });
});
