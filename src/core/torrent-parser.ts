import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import bencode from 'bencode';
import type { TorrentMeta, TorrentFile } from '../config/types.js';

/**
 * Parse a .torrent file and extract metadata.
 * Computes info_hash by SHA1-hashing the raw bencoded info dictionary.
 */
export function parseTorrentFile(filePath: string): TorrentMeta {
  const raw = readFileSync(filePath);
  const decoded = bencode.decode(raw);

  if (!decoded.info) {
    throw new Error(`Invalid torrent file: missing info dictionary — ${filePath}`);
  }

  // Re-encode the info dict to get exact bytes for hashing
  const infoRaw = bencode.encode(decoded.info);
  const infoHash = createHash('sha1').update(infoRaw).digest();

  const info = decoded.info;
  const name = info.name ? Buffer.from(info.name).toString('utf-8') : basename(filePath, '.torrent');
  const pieceLength = info['piece length'] ?? 0;
  const isPrivate = info.private === 1;

  // Extract files
  const files: TorrentFile[] = [];
  let totalSize = 0;

  if (info.files) {
    // Multi-file torrent
    for (const f of info.files) {
      const pathParts = (f.path as Array<Buffer | Uint8Array>).map((p) => Buffer.from(p).toString('utf-8'));
      const path = pathParts.join('/');
      const length = f.length as number;
      files.push({ path, length });
      totalSize += length;
    }
  } else {
    // Single-file torrent
    const length = (info.length as number) ?? 0;
    files.push({ path: name, length });
    totalSize = length;
  }

  // Extract tracker URLs
  const trackers: string[] = [];

  if (decoded.announce) {
    const announceUrl = Buffer.from(decoded.announce).toString('utf-8');
    trackers.push(announceUrl);
  }

  if (decoded['announce-list']) {
    for (const tier of decoded['announce-list']) {
      if (Array.isArray(tier)) {
        for (const url of tier) {
          const urlStr = Buffer.from(url).toString('utf-8');
          if (!trackers.includes(urlStr)) {
            trackers.push(urlStr);
          }
        }
      }
    }
  }

  return {
    infoHash,
    name,
    totalSize,
    files,
    trackers,
    pieceLength,
    isPrivate,
    filePath,
  };
}

/** Convert info_hash buffer to hex string */
export function infoHashToHex(infoHash: Buffer): string {
  return infoHash.toString('hex');
}
