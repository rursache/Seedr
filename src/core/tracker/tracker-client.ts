import type { AnnounceEvent, AnnounceResponse, ClientProfile } from '../../config/types.js';
import type { QueryParams } from '../client-emulator.js';
import { buildAnnounceQuery, getRequestHeaders } from '../client-emulator.js';
import { httpAnnounce } from './http-tracker.js';
import { udpAnnounce } from './udp-tracker.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('tracker-client');

/**
 * Dispatch announce to the correct tracker protocol (HTTP or UDP).
 */
export async function announce(
  trackerUrl: string,
  profile: ClientProfile,
  params: QueryParams,
  event: AnnounceEvent
): Promise<AnnounceResponse> {
  const url = trackerUrl.toLowerCase();

  if (url.startsWith('udp://')) {
    return udpAnnounce(
      trackerUrl,
      params.infoHash,
      params.peerId,
      params.port,
      params.uploaded,
      params.downloaded,
      params.left,
      event,
      params.key,
      event === 'stopped' ? profile.numwantOnStop : profile.numwant
    );
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const queryString = buildAnnounceQuery(profile, params, event);
    const headers = getRequestHeaders(profile);
    return httpAnnounce(trackerUrl, queryString, headers);
  }

  logger.warn({ trackerUrl }, 'Unknown tracker protocol');
  throw new Error(`Unsupported tracker protocol: ${trackerUrl}`);
}
