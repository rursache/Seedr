import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock both tracker implementations
vi.mock('../src/core/tracker/http-tracker.js', () => ({
  httpAnnounce: vi.fn(),
}));

vi.mock('../src/core/tracker/udp-tracker.js', () => ({
  udpAnnounce: vi.fn(),
}));

vi.mock('../src/core/client-emulator.js', () => ({
  buildAnnounceQuery: vi.fn(() => 'info_hash=test&peer_id=test'),
  getRequestHeaders: vi.fn(() => [{ name: 'User-Agent', value: 'test/1.0' }]),
}));

import { announce } from '../src/core/tracker/tracker-client.js';
import { httpAnnounce } from '../src/core/tracker/http-tracker.js';
import { udpAnnounce } from '../src/core/tracker/udp-tracker.js';
import type { AnnounceResponse, ClientProfile } from '../src/config/types.js';
import type { QueryParams } from '../src/core/client-emulator.js';

const mockedHttp = vi.mocked(httpAnnounce);
const mockedUdp = vi.mocked(udpAnnounce);

const fakeResponse: AnnounceResponse = {
  interval: 1800,
  seeders: 5,
  leechers: 3,
  peers: [],
};

function makeParams(): QueryParams {
  return {
    infoHash: Buffer.from('01234567890123456789'),
    peerId: Buffer.from('-qB5140-aabbccddeeff'),
    port: 12345,
    uploaded: 1000,
    downloaded: 0,
    left: 0,
    event: '',
    numwant: 200,
    key: 'AABB1122',
  };
}

function makeProfile(): ClientProfile {
  return {
    name: 'test',
    version: '1.0',
    keyGenerator: {} as any,
    peerIdGenerator: {} as any,
    urlEncoder: { encodingExclusionPattern: '[A-Za-z0-9]', encodedHexCase: 'upper' },
    query: '?info_hash={infohash}',
    numwant: 200,
    numwantOnStop: 0,
    requestHeaders: [{ name: 'User-Agent', value: 'test/1.0' }],
  };
}

describe('TrackerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route http:// URLs to HTTP announce', async () => {
    mockedHttp.mockResolvedValue(fakeResponse);

    const result = await announce(
      'http://tracker.example.com/announce',
      makeProfile(), makeParams(), ''
    );

    expect(mockedHttp).toHaveBeenCalledOnce();
    expect(mockedUdp).not.toHaveBeenCalled();
    expect(result).toEqual(fakeResponse);
  });

  it('should route https:// URLs to HTTP announce', async () => {
    mockedHttp.mockResolvedValue(fakeResponse);

    await announce(
      'https://tracker.example.com/announce',
      makeProfile(), makeParams(), ''
    );

    expect(mockedHttp).toHaveBeenCalledOnce();
    expect(mockedUdp).not.toHaveBeenCalled();
  });

  it('should route udp:// URLs to UDP announce', async () => {
    mockedUdp.mockResolvedValue(fakeResponse);

    const result = await announce(
      'udp://tracker.example.com:6969/announce',
      makeProfile(), makeParams(), ''
    );

    expect(mockedUdp).toHaveBeenCalledOnce();
    expect(mockedHttp).not.toHaveBeenCalled();
    expect(result).toEqual(fakeResponse);
  });

  it('should be case-insensitive for protocol', async () => {
    mockedHttp.mockResolvedValue(fakeResponse);
    mockedUdp.mockResolvedValue(fakeResponse);

    await announce('HTTP://tracker.example.com/announce', makeProfile(), makeParams(), '');
    expect(mockedHttp).toHaveBeenCalledOnce();

    await announce('UDP://tracker.example.com:6969/announce', makeProfile(), makeParams(), '');
    expect(mockedUdp).toHaveBeenCalledOnce();
  });

  it('should throw for unsupported protocols', async () => {
    await expect(
      announce('ftp://tracker.example.com/announce', makeProfile(), makeParams(), '')
    ).rejects.toThrow('Unsupported tracker protocol');

    await expect(
      announce('wss://tracker.example.com/announce', makeProfile(), makeParams(), '')
    ).rejects.toThrow('Unsupported tracker protocol');
  });

  it('should pass correct parameters to UDP announce', async () => {
    mockedUdp.mockResolvedValue(fakeResponse);
    const params = makeParams();
    const profile = makeProfile();

    await announce('udp://tracker.example.com:6969', profile, params, 'started');

    expect(mockedUdp).toHaveBeenCalledWith(
      'udp://tracker.example.com:6969',
      params.infoHash,
      params.peerId,
      params.port,
      params.uploaded,
      params.downloaded,
      params.left,
      'started',
      params.key,
      profile.numwant
    );
  });

  it('should use numwantOnStop for stopped events', async () => {
    mockedUdp.mockResolvedValue(fakeResponse);
    const params = makeParams();
    const profile = makeProfile();
    profile.numwantOnStop = 0;

    await announce('udp://tracker.example.com:6969', profile, params, 'stopped');

    expect(mockedUdp).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      expect.any(Buffer),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      'stopped',
      expect.any(String),
      0 // numwantOnStop
    );
  });
});
