import { describe, it, expect } from 'vitest';
import { parseTorrentFile, infoHashToHex } from '../src/core/torrent-parser.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import bencode from 'bencode';
import { createHash } from 'node:crypto';

const TEST_DIR = join(import.meta.dirname, '__fixtures__');

function createTestTorrent(opts: {
  name: string;
  length?: number;
  files?: Array<{ path: string[]; length: number }>;
  announce: string;
  announceList?: string[][];
  isPrivate?: boolean;
}): string {
  const info: any = {
    name: Buffer.from(opts.name),
    'piece length': 262144,
    pieces: Buffer.alloc(20), // dummy
  };

  if (opts.files) {
    info.files = opts.files.map((f) => ({
      path: f.path.map((p) => Buffer.from(p)),
      length: f.length,
    }));
  } else {
    info.length = opts.length ?? 1024;
  }

  if (opts.isPrivate) {
    info.private = 1;
  }

  const torrent: any = {
    announce: Buffer.from(opts.announce),
    info,
  };

  if (opts.announceList) {
    torrent['announce-list'] = opts.announceList.map((tier) =>
      tier.map((url) => Buffer.from(url))
    );
  }

  const filePath = join(TEST_DIR, `${opts.name.replace(/\s+/g, '_')}.torrent`);
  writeFileSync(filePath, bencode.encode(torrent));
  return filePath;
}

describe('torrent-parser', () => {
  // Setup/teardown
  mkdirSync(TEST_DIR, { recursive: true });

  it('should parse a single-file torrent', () => {
    const path = createTestTorrent({
      name: 'test-single',
      length: 5000,
      announce: 'http://tracker.example.com/announce',
    });

    const meta = parseTorrentFile(path);

    expect(meta.name).toBe('test-single');
    expect(meta.totalSize).toBe(5000);
    expect(meta.files).toHaveLength(1);
    expect(meta.files[0]!.path).toBe('test-single');
    expect(meta.files[0]!.length).toBe(5000);
    expect(meta.trackers).toContain('http://tracker.example.com/announce');
    expect(meta.infoHash).toBeInstanceOf(Buffer);
    expect(meta.infoHash.length).toBe(20);
  });

  it('should parse a multi-file torrent', () => {
    const path = createTestTorrent({
      name: 'test-multi',
      files: [
        { path: ['folder', 'file1.txt'], length: 1000 },
        { path: ['folder', 'file2.txt'], length: 2000 },
      ],
      announce: 'http://tracker.example.com/announce',
    });

    const meta = parseTorrentFile(path);

    expect(meta.name).toBe('test-multi');
    expect(meta.totalSize).toBe(3000);
    expect(meta.files).toHaveLength(2);
    expect(meta.files[0]!.path).toBe('folder/file1.txt');
    expect(meta.files[1]!.path).toBe('folder/file2.txt');
  });

  it('should extract multiple trackers from announce-list', () => {
    const path = createTestTorrent({
      name: 'test-trackers',
      length: 100,
      announce: 'http://primary.example.com/announce',
      announceList: [
        ['http://primary.example.com/announce', 'http://backup.example.com/announce'],
        ['udp://tracker.example.com:6969/announce'],
      ],
    });

    const meta = parseTorrentFile(path);

    expect(meta.trackers).toHaveLength(3);
    expect(meta.trackers).toContain('http://primary.example.com/announce');
    expect(meta.trackers).toContain('http://backup.example.com/announce');
    expect(meta.trackers).toContain('udp://tracker.example.com:6969/announce');
  });

  it('should compute correct info_hash', () => {
    const path = createTestTorrent({
      name: 'hash-test',
      length: 512,
      announce: 'http://tracker.test/announce',
    });

    const meta = parseTorrentFile(path);

    // Re-verify by manually computing
    const raw = require('fs').readFileSync(path);
    const decoded = bencode.decode(raw);
    const infoRaw = bencode.encode(decoded.info);
    const expected = createHash('sha1').update(infoRaw).digest();

    expect(meta.infoHash).toEqual(expected);
    expect(infoHashToHex(meta.infoHash)).toBe(expected.toString('hex'));
  });

  it('should detect private torrents', () => {
    const path = createTestTorrent({
      name: 'private-test',
      length: 100,
      announce: 'http://private.tracker/announce',
      isPrivate: true,
    });

    const meta = parseTorrentFile(path);
    expect(meta.isPrivate).toBe(true);
  });

  // Cleanup
  it('cleanup', () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });
});
