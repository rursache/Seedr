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
  port: number; // 0 = random, default 49152
  minUploadRate: number; // KB/s
  maxUploadRate: number; // KB/s
  simultaneousSeed: number;
  seedRotationInterval: number; // minutes between rotation, -1 = disabled
  keepTorrentWithZeroLeechers: boolean;
  skipIfNoPeers: boolean;
  minLeechers: number;
  minSeeders: number;
  uploadRatioTarget: number; // -1 = unlimited
  showFileName: boolean; // show .torrent filename instead of torrent title in UI
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
  seeders: number;
  leechers: number;
  consecutiveFailures: number;
  announceCount: number;
  lastEvent: AnnounceEvent;
  active: boolean; // in active slot (selected for seeding)
  seeding: boolean; // at least one successful announce — actually seeding
  completed: boolean; // upload ratio target reached — still announces but no bandwidth
}

export interface PortCheckStatus {
  checking: boolean;
  result: { reachable: boolean; nodes: Array<{ location: string; success: boolean; time?: number; error?: string }> } | null;
  error: string | null;
}

export interface SeedrStatus {
  running: boolean;
  externalIp: string | null;
  externalIpv6: string | null;
  port: number;
  client: string;
  globalUploadRate: number; // target rate in KB/s
  actualUploadRate: number; // real throughput in bytes/s from last tick
  torrents: TorrentRuntimeState[];
  uptime: number;
  portCheck: PortCheckStatus;
}
