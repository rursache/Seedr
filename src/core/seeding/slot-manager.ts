import type { AnnounceEvent, TorrentRuntimeState } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';
import { isRotationEligible } from './announce-policy.js';
import type { SeedContext } from './context.js';

const logger = createLogger('slot-manager');

type TorrentEntry = [string, TorrentRuntimeState];

/** Torrents currently holding an active slot. Completed torrents release theirs. */
export function getSlotOccupyingTorrents(ctx: SeedContext): TorrentEntry[] {
  return [...ctx.torrents.entries()].filter(([_, t]) => t.active && !t.completed);
}

export function getQueuedTorrents(ctx: SeedContext): TorrentEntry[] {
  return [...ctx.torrents.entries()].filter(([_, t]) => !t.active && !t.completed);
}

/**
 * Activate a queued torrent: mark active, reset announce state, schedule announce.
 */
export function activateTorrent(ctx: SeedContext, hash: string): void {
  const torrent = ctx.torrents.get(hash);
  if (!torrent || torrent.active) return;

  torrent.active = true;
  torrent.seeding = false;
  torrent.lastEvent = '' as AnnounceEvent;
  torrent.consecutiveFailures = 0;
  torrent.lastFailureTransient = false;
  ctx.activatedAt.set(hash, Date.now());

  if (ctx.running) {
    ctx.bandwidth.updateTorrent(hash, { active: true, eligible: false });
    ctx.scheduler.schedule(hash, 0);
  }
}

/**
 * Deactivate an active torrent: mark inactive, send stopped announce, remove from scheduler.
 */
export function deactivateTorrent(ctx: SeedContext, hash: string): void {
  const torrent = ctx.torrents.get(hash);
  if (!torrent || !torrent.active) return;

  torrent.active = false;
  ctx.activatedAt.delete(hash);

  if (ctx.running) {
    ctx.bandwidth.updateTorrent(hash, { active: false, eligible: false });
    ctx.scheduler.remove(hash);

    // Send stopped announce (fire-and-forget)
    if (torrent.lastEvent !== 'stopped' && torrent.seeding) {
      ctx.announceForTorrent(hash, 'stopped').catch(() => {});
    }
  }
}

export function rebalanceActiveTorrents(ctx: SeedContext): void {
  const active = getSlotOccupyingTorrents(ctx);
  const inactive = getQueuedTorrents(ctx);
  const limit = ctx.config.simultaneousSeed;

  if (limit === -1) {
    // Unlimited — activate all non-completed torrents
    for (const [hash] of inactive) {
      activateTorrent(ctx, hash);
    }
  } else if (limit > 0 && active.length > limit) {
    // Deactivate excess torrents
    const excess = active.slice(limit);
    for (const [hash] of excess) {
      deactivateTorrent(ctx, hash);
    }
  } else if (limit > 0 && active.length < limit && inactive.length > 0) {
    // Activate more torrents
    const slotsAvailable = limit - active.length;
    const toActivate = inactive.slice(0, slotsAvailable);
    for (const [hash] of toActivate) {
      activateTorrent(ctx, hash);
    }
  }
}

/**
 * Activate the next queued torrent (if any).
 */
export function activateNextQueued(ctx: SeedContext): void {
  const inactive = getQueuedTorrents(ctx);
  if (inactive.length === 0) return;

  const [hash, torrent] = inactive[0]!;
  activateTorrent(ctx, hash);
  logger.info({ activated: torrent.meta.name }, 'Queued torrent activated');
}

/**
 * Free a completed torrent's active slot and activate a queued replacement.
 */
export function freeCompletedSlot(ctx: SeedContext, infoHash: string): void {
  const inactive = getQueuedTorrents(ctx);
  if (inactive.length === 0) return;

  const completed = ctx.torrents.get(infoHash);
  deactivateTorrent(ctx, infoHash);

  const [nextHash, nextTorrent] = inactive[0]!;
  activateTorrent(ctx, nextHash);

  logger.info(
    { completed: completed?.meta.name, activated: nextTorrent.meta.name },
    'Slot freed on ratio completion'
  );
}

/**
 * Rotate one torrent: deactivate the longest-active, activate the longest-queued.
 * Skips torrents that don't meet peer eligibility requirements (they shouldn't
 * take a slot from a torrent that does).
 */
export function rotateTorrents(ctx: SeedContext): void {
  if (!ctx.running) return;
  if (ctx.config.simultaneousSeed === -1) return;

  const inactive = [...ctx.torrents.entries()].filter(([_, t]) => !t.active);
  if (inactive.length === 0) return;

  // Find the longest-active torrent (earliest activatedAt)
  const active = [...ctx.torrents.entries()]
    .filter(([_, t]) => t.active)
    .sort((a, b) => (ctx.activatedAt.get(a[0]) || 0) - (ctx.activatedAt.get(b[0]) || 0));

  if (active.length === 0) return;

  // Find a queued torrent that is rotation-eligible (meets peer requirements).
  // If no eligible candidate exists, skip this rotation cycle.
  const candidate = inactive.find(([_, t]) => isRotationEligible(ctx.config, t));
  if (!candidate) return;

  const [outgoingHash, outgoingTorrent] = active[0]!;
  const [incomingHash, incomingTorrent] = candidate;

  deactivateTorrent(ctx, outgoingHash);
  activateTorrent(ctx, incomingHash);

  logger.info(
    { deactivated: outgoingTorrent.meta.name, activated: incomingTorrent.meta.name },
    'Torrent rotated'
  );
}
