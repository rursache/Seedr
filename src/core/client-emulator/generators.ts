import { randomBytes, randomInt } from 'node:crypto';
import RandExp from 'randexp';
import type { KeyGenerator, PeerIdGenerator } from '../../config/types.js';

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

function generateRandomPoolWithChecksum(prefix: string, pool: string, base: number): Buffer {
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
