import { describe, it, expect } from 'vitest';
import { urlEncode, urlEncodeString } from '../src/core/url-encoder.js';
import type { UrlEncoderConfig } from '../src/config/types.js';

describe('url-encoder', () => {
  it('excludes matching characters from encoding (qBittorrent style)', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9_~\\(\\)\\!\\.\\*-]',
      encodedHexCase: 'lower',
    };

    // ASCII letters and digits should pass through
    const result = urlEncode(Buffer.from('abc123'), config);
    expect(result).toBe('abc123');
  });

  it('percent-encodes non-excluded bytes', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9-]',
      encodedHexCase: 'lower',
    };

    // Space (0x20) should be encoded
    const result = urlEncode(Buffer.from([0x20, 0x41, 0xff]), config);
    expect(result).toBe('%20A%ff');
  });

  it('respects hex case setting (upper)', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9]',
      encodedHexCase: 'upper',
    };

    const result = urlEncode(Buffer.from([0xab, 0xcd]), config);
    expect(result).toBe('%AB%CD');
  });

  it('respects hex case setting (lower)', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9]',
      encodedHexCase: 'lower',
    };

    const result = urlEncode(Buffer.from([0xab, 0xcd]), config);
    expect(result).toBe('%ab%cd');
  });

  it('encodes info_hash correctly', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9_~\\(\\)\\!\\.\\*-]',
      encodedHexCase: 'lower',
    };

    // A 20-byte hash with mixed printable/non-printable
    const hash = Buffer.from([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      0x41, 0x42, // 'A', 'B'
      0x00, 0xff, 0x20, 0x7e, 0x2d, 0x5f,
      0x30, 0x31, 0x32, 0x33, // '0', '1', '2', '3'
    ]);

    const result = urlEncode(hash, config);
    expect(result).toContain('AB'); // Should not encode 'A' and 'B'
    expect(result).toContain('0123'); // Should not encode digits
    expect(result).toContain('%01'); // Should encode 0x01
  });

  it('urlEncodeString handles latin-1 chars correctly', () => {
    const config: UrlEncoderConfig = {
      encodingExclusionPattern: '[A-Za-z0-9-]',
      encodedHexCase: 'lower',
    };

    const result = urlEncodeString('A\u00d2B', config);
    expect(result).toBe('A%d2B');
  });
});
