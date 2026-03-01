import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import RandExp from 'randexp';
import type {
  ClientProfile,
  KeyGenerator,
  PeerIdGenerator,
  AnnounceEvent,
  RequestHeader,
} from '../config/types.js';
import { urlEncode, urlEncodeString } from './url-encoder.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('client-emulator');

// ── Key generation algorithms ──

function generateHashKey(length: number, noLeadingZero: boolean): string {
  while (true) {
    const hex = randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    if (noLeadingZero && hex.startsWith('0')) continue;
    return hex;
  }
}

function generateDigitRangeHexKey(lower: number, upper: number): string {
  const value = randomInt(lower, upper + 1);
  return value.toString(16);
}

export function generateKey(gen: KeyGenerator): string {
  const algo = gen.algorithm;
  let key: string;

  switch (algo.type) {
    case 'HASH':
      key = generateHashKey(algo.length, false);
      break;
    case 'HASH_NO_LEADING_ZERO':
      key = generateHashKey(algo.length, true);
      break;
    case 'DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES':
      key = generateDigitRangeHexKey(algo.inclusiveLowerBound, algo.inclusiveUpperBound);
      break;
    default:
      throw new Error(`Unknown key algorithm: ${(algo as { type: string }).type}`);
  }

  return gen.keyCase === 'upper' ? key.toUpperCase() : key.toLowerCase();
}

// ── Peer ID generation algorithms ──

function generateRegexPeerId(pattern: string): Buffer {
  const randexp = new RandExp(pattern);
  randexp.defaultRange.subtract(32, 126); // Remove printable ASCII range
  randexp.defaultRange.add(0, 65535); // Add full unicode range
  const str = randexp.gen();

  // Convert to raw bytes — characters map 1:1 to byte values (0x00-0xFF)
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes.push(code & 0xff);
  }

  return Buffer.from(bytes);
}

function generateRandomPoolWithChecksum(
  prefix: string,
  pool: string,
  base: number
): Buffer {
  // Transmission-style: prefix + random chars from pool + checksum char
  const totalLen = 20; // Standard peer ID length
  const randomLen = totalLen - prefix.length - 1; // -1 for checksum

  let result = prefix;
  let sum = 0;

  for (let i = 0; i < randomLen; i++) {
    const idx = randomInt(0, pool.length);
    result += pool[idx];
    sum += idx;
  }

  // Checksum character from pool
  const checksumIdx = sum % base;
  result += pool[checksumIdx];

  return Buffer.from(result, 'ascii');
}

export function generatePeerId(gen: PeerIdGenerator): Buffer {
  const algo = gen.algorithm;

  switch (algo.type) {
    case 'REGEX':
      return generateRegexPeerId(algo.pattern);
    case 'RANDOM_POOL_WITH_CHECKSUM':
      return generateRandomPoolWithChecksum(algo.prefix, algo.charactersPool, algo.base);
    default:
      throw new Error(`Unknown peer ID algorithm: ${(algo as { type: string }).type}`);
  }
}

// ── Client profile loading ──

export function loadClientProfile(filePath: string): ClientProfile {
  if (!existsSync(filePath)) {
    throw new Error(`Client profile not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const profile = JSON.parse(raw) as ClientProfile;

  logger.info({ file: filePath }, 'Loaded client profile');
  return profile;
}

// ── Query template substitution ──

export interface QueryParams {
  infoHash: Buffer;
  peerId: Buffer;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
  event: AnnounceEvent;
  numwant: number;
  key: string;
  ip?: string;
  ipv6?: string;
}

export function buildAnnounceQuery(
  profile: ClientProfile,
  params: QueryParams,
  event: AnnounceEvent
): string {
  const encodedInfoHash = urlEncode(params.infoHash, profile.urlEncoder);

  let encodedPeerId: string;
  if (profile.peerIdGenerator.shouldUrlEncode) {
    encodedPeerId = urlEncodeString(
      String.fromCharCode(...params.peerId),
      profile.urlEncoder
    );
  } else {
    // For clients that don't URL-encode, we still need percent-encoding for
    // non-ASCII bytes, but use the client's encoding rules
    encodedPeerId = urlEncode(params.peerId, profile.urlEncoder);
  }

  const numwant = event === 'stopped' ? profile.numwantOnStop : profile.numwant;

  let query = profile.query
    .replace('{infohash}', encodedInfoHash)
    .replace('{peerid}', encodedPeerId)
    .replace('{port}', String(params.port))
    .replace('{uploaded}', String(params.uploaded))
    .replace('{downloaded}', String(params.downloaded))
    .replace('{left}', String(params.left))
    .replace('{event}', event)
    .replace('{numwant}', String(numwant))
    .replace('{key}', params.key);

  // Handle optional IP placeholders
  if (params.ip) {
    query = query.replace('{ip}', params.ip);
  } else {
    // Remove ip param entirely if not available
    query = query.replace(/&ip=\{ip\}/, '').replace(/ip=\{ip\}&?/, '');
  }

  // Handle ipv6 placeholder (Transmission)
  if (params.ipv6) {
    query = query.replace('{ipv6}', encodeURIComponent(params.ipv6));
  } else {
    // Remove ipv6 param entirely if not available
    query = query.replace(/&ipv6=\{ipv6\}/, '').replace(/ipv6=\{ipv6\}&?/, '');
  }

  // Remove empty event param for regular announces (no event)
  if (event === '') {
    query = query.replace(/&event=(?:&|$)/, '&').replace(/event=&?/, '');
  }

  // Clean up trailing/double ampersands
  query = query.replace(/&&+/g, '&').replace(/&$/, '').replace(/\?&/, '?');

  return query;
}

export function getRequestHeaders(profile: ClientProfile): RequestHeader[] {
  return profile.requestHeaders;
}

// ── Key/PeerId refresh logic ──

export interface EmulatorState {
  peerId: Buffer;
  key: string;
  announceCount: number;
  startedAnnouncesSent: number;
  lastKeyRefresh: number;
}

export function shouldRefreshKey(
  gen: KeyGenerator,
  state: EmulatorState,
  event: AnnounceEvent
): boolean {
  switch (gen.refreshOn) {
    case 'NEVER':
      return false;
    case 'ALWAYS':
      return true;
    case 'TIMED':
      return (
        gen.refreshEvery !== undefined &&
        state.announceCount > 0 &&
        state.announceCount % gen.refreshEvery === 0
      );
    case 'TORRENT_PERSISTENT':
      return false; // Generated once per torrent, never refreshed
    case 'TORRENT_VOLATILE':
      return false; // Generated once per torrent session
    case 'TIMED_OR_AFTER_STARTED_ANNOUNCE':
      if (event === 'started') return true;
      return (
        gen.refreshEvery !== undefined &&
        state.announceCount > 0 &&
        state.announceCount % gen.refreshEvery === 0
      );
    default:
      return false;
  }
}

export function shouldRefreshPeerId(
  gen: PeerIdGenerator,
  _state: EmulatorState,
  event: AnnounceEvent
): boolean {
  switch (gen.refreshOn) {
    case 'NEVER':
      return false;
    case 'ALWAYS':
      return true;
    case 'TORRENT_VOLATILE':
      return event === 'started';
    case 'TORRENT_PERSISTENT':
      return false;
    default:
      return false;
  }
}
