// ── Client profile types (parsed from .client JSON files) ──

export type KeyAlgorithmType =
  | 'HASH'
  | 'HASH_NO_LEADING_ZERO'
  | 'DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES';

export type PeerIdAlgorithmType = 'REGEX' | 'RANDOM_POOL_WITH_CHECKSUM';

export type RefreshOn =
  | 'NEVER'
  | 'ALWAYS'
  | 'TIMED'
  | 'TORRENT_PERSISTENT'
  | 'TORRENT_VOLATILE'
  | 'TIMED_OR_AFTER_STARTED_ANNOUNCE';

export interface HashAlgorithm {
  type: 'HASH' | 'HASH_NO_LEADING_ZERO';
  length: number;
}

export interface DigitRangeAlgorithm {
  type: 'DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES';
  inclusiveLowerBound: number;
  inclusiveUpperBound: number;
}

export type KeyAlgorithm = HashAlgorithm | DigitRangeAlgorithm;

export interface RegexPeerIdAlgorithm {
  type: 'REGEX';
  pattern: string;
}

export interface RandomPoolWithChecksumAlgorithm {
  type: 'RANDOM_POOL_WITH_CHECKSUM';
  prefix: string;
  charactersPool: string;
  base: number;
}

export type PeerIdAlgorithm = RegexPeerIdAlgorithm | RandomPoolWithChecksumAlgorithm;

export interface KeyGenerator {
  algorithm: KeyAlgorithm;
  refreshOn: RefreshOn;
  refreshEvery?: number; // for TIMED / TIMED_OR_AFTER_STARTED_ANNOUNCE
  keyCase: 'upper' | 'lower';
}

export interface PeerIdGenerator {
  algorithm: PeerIdAlgorithm;
  refreshOn: RefreshOn;
  shouldUrlEncode: boolean;
}

export interface UrlEncoderConfig {
  encodingExclusionPattern: string;
  encodedHexCase: 'upper' | 'lower';
}

export interface RequestHeader {
  name: string;
  value: string;
}

export interface ClientProfile {
  keyGenerator: KeyGenerator;
  peerIdGenerator: PeerIdGenerator;
  urlEncoder: UrlEncoderConfig;
  query: string;
  numwant: number;
  numwantOnStop: number;
  requestHeaders: RequestHeader[];
}

// ── Torrent metadata (parsed from .torrent files) ──

export interface TorrentFile {
  path: string;
  length: number;
}

export interface TorrentMeta {
  infoHash: Buffer;
  name: string;
  totalSize: number;
  files: TorrentFile[];
  trackers: string[]; // flat list of tracker URLs from announce + announce-list
  pieceLength: number;
  isPrivate: boolean;
  filePath: string; // path to the .torrent file on disk
}

// ── Announce / tracker types ──

export type AnnounceEvent = 'started' | 'stopped' | 'completed' | '';

export interface AnnounceRequest {
  infoHash: Buffer;
  peerId: Buffer;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
  event: AnnounceEvent;
  numwant: number;
  key: string;
  compact: boolean;
  ip?: string;
  ipv6?: string;
}

export interface PeerInfo {
  ip: string;
  port: number;
}

export interface AnnounceResponse {
  interval: number;
  minInterval?: number;
  seeders: number;
  leechers: number;
  peers: PeerInfo[];
  failureReason?: string;
  warningMessage?: string;
}

// ── Seed state (persisted to state.json) ──

export interface TorrentSeedState {
  infoHash: string; // hex-encoded
  uploaded: number;
  downloaded: number;
  lastAnnounce: number; // timestamp
  announceCount: number;
}

export interface SeedState {
  torrents: Record<string, TorrentSeedState>; // keyed by hex info_hash
  lastSaved: number;
}

// ── App config (config.json) ──

export interface AppConfig {
  client: string;
  port: number; // 0 = random
  minUploadRate: number; // KB/s
  maxUploadRate: number; // KB/s
  simultaneousSeed: number;
  keepTorrentWithZeroLeechers: boolean;
  skipIfNoPeers: boolean;
  minLeechers: number;
  uploadRatioTarget: number; // -1 = unlimited
}

// ── Runtime types ──

export interface TorrentRuntimeState {
  meta: TorrentMeta;
  seedState: TorrentSeedState;
  peerId: Buffer;
  key: string;
  currentTracker: string;
  trackerIndex: number;
  interval: number;
  nextAnnounce: number; // timestamp
  seeders: number;
  leechers: number;
  uploadRate: number; // bytes/s currently allocated
  consecutiveFailures: number;
  announceCount: number;
  lastEvent: AnnounceEvent;
  active: boolean; // in active slot (selected for seeding)
  seeding: boolean; // at least one successful announce — actually seeding
}

export interface SeedrStatus {
  running: boolean;
  externalIp: string | null;
  externalIpv6: string | null;
  port: number;
  client: string;
  globalUploadRate: number;
  torrents: TorrentRuntimeState[];
  uptime: number;
}
