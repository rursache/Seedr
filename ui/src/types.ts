export interface TorrentInfo {
  infoHash: string;
  name: string;
  fileName: string;
  size: number;
  uploaded: number;
  reportedUploaded: number;
  seeders: number;
  leechers: number;
  active: boolean;
  seeding: boolean;
  completed: boolean;
  lastFailureTransient: boolean;
  tracker: string;
  uploadRate?: number;
  consecutiveFailures: number;
  addedIndex: number; // insertion order from backend
}

export interface AppConfig {
  client: string;
  port: number;
  minUploadRate: number;
  maxUploadRate: number;
  simultaneousSeed: number;
  seedRotationInterval: number;
  keepTorrentWithZeroLeechers: boolean;
  skipIfNoPeers: boolean;
  minLeechers: number;
  minSeeders: number;
  uploadRatioTarget: number;
  showFileName: boolean;
  theme: string;
  colorStyle: 'auto' | 'light' | 'dark';
}

export interface PortCheckStatus {
  checking: boolean;
  result: { reachable: boolean; nodes: Array<{ location: string; success: boolean; time?: number; error?: string }> } | null;
  error: string | null;
}

export interface SeedrState {
  running: boolean;
  externalIp: string | null;
  externalIpv6: string | null;
  port: number;
  client: string;
  globalUploadRate: number;
  actualUploadRate: number;
  torrents: any[];
  uptime: number;
  portCheck: PortCheckStatus;
}

export interface SeedrEvent {
  id: number;
  type: string;
  data: any;
  time: number;
}

export interface VersionInfo {
  version: string;
  commit: string;
  buildDate: string;
  isTagged: boolean;
}
