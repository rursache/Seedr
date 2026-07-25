import type { AnnounceEvent } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';
import { performAnnounce } from '../announcer.js';
import {
  ANNOUNCE_INTERVAL_MAX,
  ANNOUNCE_INTERVAL_MIN,
  checkRatioTarget,
  checkTorrentEligible,
  getAnnounceRetryDelay,
  isTransientAnnounceError,
} from './announce-policy.js';
import { freeCompletedSlot } from './slot-manager.js';
import type { SeedContext } from './context.js';

const logger = createLogger('announce-runner');

/**
 * Announce every torrent whose scheduled time has come. Announces are fired
 * concurrently — each one serializes on its own lock in announceForTorrent.
 */
export function pollScheduler(ctx: SeedContext): void {
  if (!ctx.running) return;

  const dueTasks = ctx.scheduler.getDueTasks();

  for (const task of dueTasks) {
    const torrent = ctx.torrents.get(task.infoHash);
    if (!torrent || !torrent.active) continue;

    const event: AnnounceEvent =
      torrent.lastEvent === '' || torrent.lastEvent === 'stopped' ? 'started' : '';

    ctx.announceForTorrent(task.infoHash, event).catch((err) => {
      logger.error({ infoHash: task.infoHash, error: err }, 'Announce poll error');
    });
  }
}

/** Chain through the per-torrent lock to prevent concurrent announces. */
export function announceForTorrent(
  ctx: SeedContext,
  infoHash: string,
  event: AnnounceEvent
): Promise<void> {
  const prev = ctx.announceLocks.get(infoHash) || Promise.resolve();
  const next = prev.then(() => doAnnounce(ctx, infoHash, event)).catch(() => {});
  ctx.announceLocks.set(infoHash, next);
  return next;
}

async function doAnnounce(ctx: SeedContext, infoHash: string, event: AnnounceEvent): Promise<void> {
  const torrent = ctx.torrents.get(infoHash);
  const emState = ctx.emulatorStates.get(infoHash);
  if (!torrent || !emState) return;

  // Calculate upload delta from bandwidth dispatcher
  // Include accumulated bytes for regular and stopped announces (flush remaining progress)
  let uploadDelta = 0;
  if (event !== 'started') {
    const eligible = checkTorrentEligible(ctx.config, torrent);
    if (eligible || event === 'stopped') {
      uploadDelta = ctx.bandwidth.consumeAccumulated(infoHash);
    }
  }

  const result = await performAnnounce(
    torrent.meta,
    torrent.seedState,
    emState,
    ctx.profile,
    event,
    ctx.connection.port,
    uploadDelta,
    ctx.connection.externalIp ?? undefined,
    ctx.connection.externalIpv6 ?? undefined,
    torrent.trackerIndex,
    torrent.consecutiveFailures
  );

  // Update runtime state
  torrent.trackerIndex = result.trackerIndex;
  torrent.consecutiveFailures = result.consecutiveFailures;
  torrent.currentTracker = result.trackerUrl;
  torrent.peerId = emState.peerId;
  torrent.key = emState.key;

  if (result.success && result.response) {
    torrent.interval = result.response.interval;
    torrent.seeders = result.response.seeders;
    torrent.leechers = result.response.leechers;
    torrent.lastEvent = event;
    torrent.announceCount = torrent.seedState.announceCount;
    torrent.seeding = true; // Successfully announced — now actually seeding
    torrent.lastFailureTransient = false;

    // Check upload ratio target — mark completed (still announces, no bandwidth)
    if (checkRatioTarget(ctx.config, torrent) && !torrent.completed) {
      torrent.completed = true;
      logger.info({ name: torrent.meta.name }, 'Upload ratio target reached');
      ctx.emit('torrent:completed', { infoHash, name: torrent.meta.name });

      // Free the active slot for a queued torrent
      if (ctx.config.simultaneousSeed !== -1) {
        freeCompletedSlot(ctx, infoHash);
      }
    }

    // Update bandwidth dispatcher: eligible based on peer counts and completion
    ctx.bandwidth.updateTorrent(infoHash, {
      seeders: result.response.seeders,
      leechers: result.response.leechers,
      eligible: checkTorrentEligible(ctx.config, torrent),
    });

    // Update state for persistence
    ctx.state.torrents[infoHash] = torrent.seedState;

    ctx.emit('announce:success', {
      infoHash,
      name: torrent.meta.name,
      tracker: result.trackerUrl,
      seeders: result.response.seeders,
      leechers: result.response.leechers,
      uploaded: torrent.seedState.uploaded,
    });
  } else {
    // Failed announce — not seeding, not eligible for bandwidth
    torrent.seeding = false;
    torrent.lastFailureTransient = isTransientAnnounceError(result.error);
    ctx.bandwidth.updateTorrent(infoHash, { eligible: false });

    // Restore consumed bytes so they aren't lost
    if (uploadDelta > 0) {
      ctx.bandwidth.restoreAccumulated(infoHash, uploadDelta);
    }

    ctx.emit('announce:failure', {
      infoHash,
      name: torrent.meta.name,
      tracker: result.trackerUrl,
      error: result.error,
    });
  }

  // Schedule next announce (unless stopped)
  if (event !== 'stopped' && torrent.active) {
    if (result.success) {
      const clampedInterval = Math.max(
        ANNOUNCE_INTERVAL_MIN,
        Math.min(torrent.interval, ANNOUNCE_INTERVAL_MAX)
      );
      ctx.scheduler.schedule(infoHash, clampedInterval * 1000);
    } else {
      const retryDelay = getAnnounceRetryDelay(torrent.consecutiveFailures, result.error);
      ctx.scheduler.schedule(infoHash, retryDelay);
    }
  }
}
