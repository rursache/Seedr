import type {
  AnnounceEvent,
  AnnounceResponse,
  ClientProfile,
  TorrentMeta,
  TorrentSeedState,
} from '../config/types.js';
import type { EmulatorState, QueryParams } from './client-emulator.js';
import {
  generateKey,
  generatePeerId,
  shouldRefreshKey,
  shouldRefreshPeerId,
} from './client-emulator.js';
import { announce } from './tracker/tracker-client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('announcer');

const MAX_CONSECUTIVE_FAILURES = 5;

export interface AnnounceResult {
  success: boolean;
  response?: AnnounceResponse;
  trackerUrl: string;
  error?: string;
}

/**
 * Perform an announce for a single torrent.
 *
 * Manages tracker failover: after MAX_CONSECUTIVE_FAILURES on one tracker,
 * moves to the next tracker in the list.
 */
export async function performAnnounce(
  meta: TorrentMeta,
  seedState: TorrentSeedState,
  emulatorState: EmulatorState,
  profile: ClientProfile,
  event: AnnounceEvent,
  port: number,
  uploadDelta: number,
  ip?: string,
  ipv6?: string,
  trackerIndex = 0,
  consecutiveFailures = 0
): Promise<AnnounceResult & { trackerIndex: number; consecutiveFailures: number }> {
  // Refresh key/peerId if needed
  if (shouldRefreshKey(profile.keyGenerator, emulatorState, event)) {
    emulatorState.key = generateKey(profile.keyGenerator);
  }
  if (shouldRefreshPeerId(profile.peerIdGenerator, emulatorState, event)) {
    emulatorState.peerId = generatePeerId(profile.peerIdGenerator);
  }

  // Build the uploaded value: previous total + delta
  const uploaded = seedState.uploaded + uploadDelta;

  const trackers = meta.trackers;
  if (trackers.length === 0) {
    return {
      success: false,
      error: 'No trackers available',
      trackerUrl: '',
      trackerIndex,
      consecutiveFailures,
    };
  }

  const currentTracker = trackers[trackerIndex % trackers.length]!;

  const params: QueryParams = {
    infoHash: meta.infoHash,
    peerId: emulatorState.peerId,
    port,
    uploaded,
    downloaded: seedState.downloaded,
    left: 0, // We're "seeding" so left = 0
    event,
    numwant: event === 'stopped' ? profile.numwantOnStop : profile.numwant,
    key: emulatorState.key,
    ip,
    ipv6,
  };

  try {
    const response = await announce(currentTracker, profile, params, event);

    if (response.failureReason) {
      logger.warn(
        { torrent: meta.name, tracker: currentTracker, reason: response.failureReason },
        'Tracker returned failure'
      );

      const newFailures = consecutiveFailures + 1;
      let newIndex = trackerIndex;

      if (newFailures >= MAX_CONSECUTIVE_FAILURES && trackers.length > 1) {
        newIndex = (trackerIndex + 1) % trackers.length;
        logger.info(
          { torrent: meta.name, newTracker: trackers[newIndex] },
          'Switching to next tracker after consecutive failures'
        );
        return {
          success: false,
          response,
          trackerUrl: currentTracker,
          error: response.failureReason,
          trackerIndex: newIndex,
          consecutiveFailures: 0,
        };
      }

      return {
        success: false,
        response,
        trackerUrl: currentTracker,
        error: response.failureReason,
        trackerIndex,
        consecutiveFailures: newFailures,
      };
    }

    // Success — update state
    seedState.uploaded = uploaded;
    seedState.lastAnnounce = Date.now();
    seedState.announceCount++;
    emulatorState.announceCount++;

    if (event === 'started') {
      emulatorState.startedAnnouncesSent++;
    }

    logger.info(
      {
        torrent: meta.name,
        tracker: currentTracker,
        seeders: response.seeders,
        leechers: response.leechers,
        interval: response.interval,
        uploaded,
      },
      'Announce success'
    );

    return {
      success: true,
      response,
      trackerUrl: currentTracker,
      trackerIndex,
      consecutiveFailures: 0,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ torrent: meta.name, tracker: currentTracker, error: errMsg }, 'Announce failed');

    const newFailures = consecutiveFailures + 1;
    let newIndex = trackerIndex;

    if (newFailures >= MAX_CONSECUTIVE_FAILURES && trackers.length > 1) {
      newIndex = (trackerIndex + 1) % trackers.length;
      logger.info(
        { torrent: meta.name, newTracker: trackers[newIndex] },
        'Switching to next tracker'
      );
      return {
        success: false,
        trackerUrl: currentTracker,
        error: errMsg,
        trackerIndex: newIndex,
        consecutiveFailures: 0,
      };
    }

    return {
      success: false,
      trackerUrl: currentTracker,
      error: errMsg,
      trackerIndex,
      consecutiveFailures: newFailures,
    };
  }
}
