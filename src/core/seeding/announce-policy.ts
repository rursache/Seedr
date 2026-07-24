import type { AppConfig, TorrentRuntimeState } from '../../config/types.js';

export const ANNOUNCE_INTERVAL_MIN = 60; // seconds
export const ANNOUNCE_INTERVAL_MAX = 86_400; // 1 day in seconds

const RETRY_BASE_DELAY = 30_000; // 30s base retry delay
const RETRY_MAX_DELAY = 480_000; // 8 min max retry delay
const TRANSIENT_RETRY_BASE_DELAY = 3_000; // 3s base retry for transient tracker/server errors
const TRANSIENT_RETRY_MAX_DELAY = 48_000; // 48s cap for transient tracker/server errors

export function checkTorrentEligible(config: AppConfig, torrent: TorrentRuntimeState): boolean {
  if (torrent.completed) return false;
  if (config.skipIfNoPeers && torrent.seeders + torrent.leechers === 0) return false;
  if (!config.keepTorrentWithZeroLeechers && torrent.leechers === 0) return false;
  if (torrent.leechers < config.minLeechers) return false;
  if (torrent.seeders < config.minSeeders) return false;
  return true;
}

export function checkRatioTarget(config: AppConfig, torrent: TorrentRuntimeState): boolean {
  if (config.uploadRatioTarget <= 0) return false;
  if (torrent.meta.totalSize === 0) return false;
  const ratio = torrent.seedState.uploaded / torrent.meta.totalSize;
  return ratio >= config.uploadRatioTarget;
}

/**
 * Check whether a queued torrent is eligible for rotation into an active slot.
 * A torrent that has already completed its ratio target, or that doesn't meet
 * the configured peer requirements, should not displace an active torrent.
 */
export function isRotationEligible(config: AppConfig, torrent: TorrentRuntimeState): boolean {
  if (torrent.completed) return false;
  // For queued torrents that haven't announced yet, peer counts are 0.
  // Only apply peer filters to torrents that have previously announced
  // (seeders/leechers > 0 means the torrent has been active before).
  if (torrent.seeders === 0 && torrent.leechers === 0) return true;
  if (config.skipIfNoPeers && torrent.seeders + torrent.leechers === 0) return false;
  if (!config.keepTorrentWithZeroLeechers && torrent.leechers === 0) return false;
  if (torrent.leechers < config.minLeechers) return false;
  if (torrent.seeders < config.minSeeders) return false;
  return true;
}

export function isTransientAnnounceError(error?: string): boolean {
  if (!error) return false;

  return /HTTP tracker returned status 5\d\d\b/i.test(error) ||
    /(?:timed out|timeout|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up)/i.test(error);
}

export function getAnnounceRetryDelay(consecutiveFailures: number, error?: string): number {
  const failureCount = Math.max(1, consecutiveFailures);

  if (isTransientAnnounceError(error)) {
    return Math.min(
      TRANSIENT_RETRY_BASE_DELAY * Math.pow(2, failureCount - 1),
      TRANSIENT_RETRY_MAX_DELAY
    );
  }

  return Math.min(RETRY_BASE_DELAY * Math.pow(2, failureCount - 1), RETRY_MAX_DELAY);
}
