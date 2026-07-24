import type { ClientProfile, AnnounceEvent, RequestHeader } from '../../config/types.js';
import { urlEncode, urlEncodeString } from '../url-encoder.js';

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

/**
 * Build the announce query from the client's own template. Parameter order and
 * encoding come from the profile verbatim — both are part of the fingerprint a
 * tracker sees, so nothing here may be normalised or reordered.
 */
export function buildAnnounceQuery(
  profile: ClientProfile,
  params: QueryParams,
  event: AnnounceEvent
): string {
  const encodedInfoHash = urlEncode(params.infoHash, profile.urlEncoder);

  let encodedPeerId: string;
  if (profile.peerIdGenerator.shouldUrlEncode) {
    encodedPeerId = urlEncodeString(String.fromCharCode(...params.peerId), profile.urlEncoder);
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
