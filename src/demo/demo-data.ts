import type { SeedrStatus, TorrentRuntimeState } from '../config/types.js';

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

function randomHex(len: number): string {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

interface MockTorrent {
  name: string;
  fileName: string;
  size: number;
  tracker: string;
  seeders: number;
  leechers: number;
  uploaded: number;
  reportedUploaded: number;
  uploadRate: number;
  active: boolean;
  seeding: boolean;
  completed: boolean;
  consecutiveFailures: number;
  announceCount: number;
}

const MOCK_TORRENTS: MockTorrent[] = [
  // Tracker 1: tracker.bitsoup.yum — 3 torrents (2 seeding, 1 completed)
  {
    name: 'Galactic.Plumbers.S02E07.The.Clogged.Nebula.1080p.WEB.h264-WRENCH',
    fileName: 'Galactic.Plumbers.S02E07.1080p.WEB.h264-WRENCH.torrent',
    size: 1_825_361_920,
    tracker: 'https://tracker.bitsoup.yum/announce',
    seeders: 142,
    leechers: 38,
    uploaded: 5_637_144_576,
    reportedUploaded: 5_603_590_144,
    uploadRate: 524_288,
    active: true,
    seeding: true,
    completed: false,
    consecutiveFailures: 0,
    announceCount: 87,
  },
  {
    name: 'Quantum.Cats.2025.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-MEOW',
    fileName: 'Quantum.Cats.2025.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-MEOW.torrent',
    size: 18_253_611_008,
    tracker: 'https://tracker.bitsoup.yum/announce',
    seeders: 312,
    leechers: 67,
    uploaded: 36_507_222_016,
    reportedUploaded: 36_507_222_016,
    uploadRate: 0,
    active: false,
    seeding: false,
    completed: true,
    consecutiveFailures: 0,
    announceCount: 423,
  },
  {
    name: 'Murder.Bongos.S01E03.720p.AMZN.WEB-DL.DDP5.1.H.264-BONK',
    fileName: 'Murder.Bongos.S01E03.720p.AMZN.WEB-DL.DDP5.1.H.264-BONK.torrent',
    size: 3_221_225_472,
    tracker: 'https://tracker.bitsoup.yum/announce',
    seeders: 89,
    leechers: 214,
    uploaded: 12_884_901_888,
    reportedUploaded: 12_851_347_456,
    uploadRate: 786_432,
    active: true,
    seeding: true,
    completed: false,
    consecutiveFailures: 0,
    announceCount: 156,
  },

  // Tracker 2: tracker.pixeldust.io — 2 torrents (1 seeding, 1 error)
  {
    name: 'Raccoons.in.Space.2024.1080p.BluRay.x264-TRASHPANDA',
    fileName: 'Raccoons.in.Space.2024.1080p.BluRay.x264-TRASHPANDA.torrent',
    size: 9_663_676_416,
    tracker: 'https://tracker.pixeldust.io/announce',
    seeders: 1_847,
    leechers: 523,
    uploaded: 8_589_934_592,
    reportedUploaded: 8_556_380_160,
    uploadRate: 393_216,
    active: true,
    seeding: true,
    completed: false,
    consecutiveFailures: 0,
    announceCount: 312,
  },
  {
    name: 'Toaster.Revolution.S05E12.Final.720p.WEB-DL.DDP5.1.H.264-CRISPY',
    fileName: 'Toaster.Revolution.S05E12.Final.720p.WEB-DL.DDP5.1.H.264-CRISPY.torrent',
    size: 1_610_612_736,
    tracker: 'https://tracker.pixeldust.io/announce',
    seeders: 0,
    leechers: 0,
    uploaded: 0,
    reportedUploaded: 0,
    uploadRate: 0,
    active: false,
    seeding: false,
    completed: false,
    consecutiveFailures: 3,
    announceCount: 5,
  },
];

function buildTorrentState(mock: MockTorrent, index: number): TorrentRuntimeState & { uploadRate: number; reportedUploaded: number } {
  const infoHash = randomHex(40);
  return {
    meta: {
      infoHash: hexToBuffer(infoHash),
      name: mock.name,
      totalSize: mock.size,
      files: [{ path: mock.name, length: mock.size }],
      trackers: [mock.tracker],
      pieceLength: 16384,
      isPrivate: true,
      filePath: `/data/torrents/${mock.fileName}`,
    },
    seedState: {
      infoHash,
      uploaded: mock.uploaded,
      downloaded: mock.size,
      lastAnnounce: Date.now() - (index * 120_000),
      announceCount: mock.announceCount,
    },
    peerId: Buffer.from(`-qB5140-${randomHex(12)}`),
    key: randomHex(8),
    currentTracker: mock.tracker,
    trackerIndex: 0,
    interval: 1800,
    seeders: mock.seeders,
    leechers: mock.leechers,
    consecutiveFailures: mock.consecutiveFailures,
    announceCount: mock.announceCount,
    lastEvent: '' as const,
    active: mock.active,
    seeding: mock.seeding,
    completed: mock.completed,
    uploadRate: mock.uploadRate,
    reportedUploaded: mock.reportedUploaded,
  };
}

// Cache so the data stays stable across WebSocket ticks
let cachedStatus: SeedrStatus | null = null;

export function getDemoStatus(): SeedrStatus {
  if (cachedStatus) return cachedStatus;

  const torrents = MOCK_TORRENTS.map((m, i) => buildTorrentState(m, i));

  cachedStatus = {
    running: true,
    externalIp: '203.0.113.42',
    externalIpv6: null,
    port: 51413,
    client: 'qbittorrent-5.1.0',
    globalUploadRate: 500,
    actualUploadRate: torrents.reduce((sum, t) => sum + t.uploadRate, 0),
    torrents,
    uptime: 864_000_000,
    portCheck: {
      checking: false,
      result: {
        reachable: true,
        nodes: [
          { location: 'US East', success: true, time: 42 },
          { location: 'EU West', success: true, time: 78 },
        ],
      },
      error: null,
    },
  };

  return cachedStatus;
}

export function getDemoTorrentList() {
  const status = getDemoStatus();
  return status.torrents.map((t: any) => ({
    infoHash: t.seedState.infoHash,
    name: t.meta.name,
    fileName: t.meta.filePath.split('/').pop() || '',
    size: t.meta.totalSize,
    uploaded: t.seedState.uploaded,
    reportedUploaded: t.reportedUploaded,
    seeders: t.seeders,
    leechers: t.leechers,
    active: t.active,
    seeding: t.seeding,
    completed: t.completed,
    tracker: t.currentTracker,
    uploadRate: t.uploadRate,
    consecutiveFailures: t.consecutiveFailures,
    addedIndex: 0,
  }));
}
