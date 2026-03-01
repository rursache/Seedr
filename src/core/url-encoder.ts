import type { UrlEncoderConfig } from '../config/types.js';

/**
 * Client-specific URL percent-encoding.
 * Each client has an exclusion pattern (characters that should NOT be encoded)
 * and a hex case preference.
 */
export function urlEncode(data: Buffer, config: UrlEncoderConfig): string {
  const exclusionRegex = new RegExp(config.encodingExclusionPattern);
  const hexCase = config.encodedHexCase;
  let result = '';

  for (const byte of data) {
    const char = String.fromCharCode(byte);
    if (exclusionRegex.test(char)) {
      result += char;
    } else {
      const hex = byte.toString(16).padStart(2, '0');
      result += '%' + (hexCase === 'upper' ? hex.toUpperCase() : hex.toLowerCase());
    }
  }

  return result;
}

/**
 * URL-encode a string using client-specific encoding rules.
 * First converts the string to a byte buffer, then applies per-byte encoding.
 */
export function urlEncodeString(str: string, config: UrlEncoderConfig): string {
  // Convert to bytes preserving raw byte values for chars 0x00-0xFF
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0xff) {
      bytes.push(code);
    } else {
      // Multi-byte: use UTF-8 encoding
      const encoded = Buffer.from(str[i]!, 'utf-8');
      for (const b of encoded) {
        bytes.push(b);
      }
    }
  }

  return urlEncode(Buffer.from(bytes), config);
}
