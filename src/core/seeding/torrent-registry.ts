import { readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { TORRENTS_DIR } from '../../config/config.js';
import type {
  AnnounceEvent,
  EmulatorState,
  TorrentRuntimeState,
  TorrentSeedState,
} from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';
import { parseTorrentFile, infoHashToHex } from '../torrent-parser.js';
import { generateKey, generatePeerId } from '../client-emulator/generators.js';
import { activateNextQueued, getSlotOccupyingTorrents } from './slot-manager.js';
import type { SeedContext } from './context.js';

const logger = createLogger('torrent-registry');

/** Load every .torrent already sitting in the watched directory. */
export function scanTorrents(ctx: SeedContext): void {
  if (!existsSync(TORRENTS_DIR)) return;

  const files = readdirSync(TORRENTS_DIR).filter((f) => f.endsWith('.torrent'));

  for (const file of files) {
    addTorrent(ctx, join(TORRENTS_DIR, file));
  }

  logger.info({ count: files.length }, 'Scanned torrents directory');
}

export function addTorrent(ctx: SeedContext, filePath: string): boolean {
  try {
    const meta = parseTorrentFile(filePath);
    const hexHash = infoHashToHex(meta.infoHash);

    if (ctx.torrents.has(hexHash)) {
      logger.debug({ name: meta.name }, 'Torrent already loaded');
      return false;
    }

    // Check simultaneous seed limit (-1 = unlimited)
    const activeCount = getSlotOccupyingTorrents(ctx).length;
    const active = ctx.config.simultaneousSeed === -1 || activeCount < ctx.config.simultaneousSeed;

    // Restore or create seed state
    const seedState: TorrentSeedState = ctx.state.torrents[hexHash] || {
      infoHash: hexHash,
      uploaded: 0,
      downloaded: 0,
      lastAnnounce: 0,
      announceCount: 0,
    };

    // Generate initial key and peer ID
    const key = generateKey(ctx.profile.keyGenerator);
    const peerId = generatePeerId(ctx.profile.peerIdGenerator);

    const emulatorState: EmulatorState = {
      peerId,
      key,
      announceCount: 0,
      startedAnnouncesSent: 0,
      lastKeyRefresh: Date.now(),
    };

    const runtimeState: TorrentRuntimeState = {
      meta,
      seedState,
      peerId,
      key,
      currentTracker: meta.trackers[0] || '',
      trackerIndex: 0,
      interval: 1800,
      seeders: 0,
      leechers: 0,
      consecutiveFailures: 0,
      announceCount: seedState.announceCount,
      lastEvent: '' as AnnounceEvent,
      active,
      seeding: false, // Not seeding until first successful announce
      completed: false, // Set when upload ratio target is reached
      lastFailureTransient: false,
    };

    ctx.torrents.set(hexHash, runtimeState);
    ctx.emulatorStates.set(hexHash, emulatorState);

    // If engine is running, register with bandwidth dispatcher and schedule announce
    if (ctx.running) {
      ctx.bandwidth.registerTorrent({
        infoHash: hexHash,
        seeders: 0,
        leechers: 0,
        active,
        eligible: false, // Not eligible until first successful announce
      });

      // Schedule initial announce (started event)
      if (active) {
        ctx.activatedAt.set(hexHash, Date.now());
        ctx.scheduler.schedule(hexHash, 0); // Immediately
      }
    }

    ctx.emit('torrent:added', { infoHash: hexHash, name: meta.name });
    logger.info({ name: meta.name, hash: hexHash.slice(0, 8), active }, 'Torrent added');

    return true;
  } catch (error) {
    logger.error({ filePath, error }, 'Failed to add torrent');
    return false;
  }
}

/**
 * Unloads a torrent, and with `deleteFile` also removes it from the watched
 * directory.
 *
 * That flag is the difference between the two reasons this runs. A user asking
 * to remove a torrent has to delete the file: the directory is the source of
 * truth that is rescanned on every start, so unloading alone means the torrent
 * reappears after a restart. The watcher calls this without the flag, because by
 * then the file is already gone.
 *
 * The file goes first so a failure leaves the torrent loaded rather than
 * half-removed, and the caller hears about it instead of the user being told the
 * torrent was removed when it is due back on the next restart.
 */
export async function removeTorrent(
  ctx: SeedContext,
  infoHash: string,
  deleteFile = false
): Promise<void> {
  const torrent = ctx.torrents.get(infoHash);
  if (!torrent) return;
  if (deleteFile) deleteTorrentFile(torrent.meta.filePath, torrent.meta.name);
  const wasOccupyingSlot = torrent.active && !torrent.completed;

  // Send stopped announce before removing (awaited so data is still available)
  if (ctx.running && torrent.active && torrent.lastEvent !== 'stopped') {
    await ctx.announceForTorrent(infoHash, 'stopped').catch(() => {});
  }

  ctx.scheduler.remove(infoHash);
  ctx.bandwidth.removeTorrent(infoHash);
  ctx.torrents.delete(infoHash);
  ctx.emulatorStates.delete(infoHash);
  ctx.announceLocks.delete(infoHash);
  ctx.activatedAt.delete(infoHash);
  delete ctx.state.torrents[infoHash];

  ctx.emit('torrent:removed', { infoHash });
  logger.info({ name: torrent.meta.name }, 'Torrent removed');

  // If an active torrent was removed and we have a seed limit, activate a queued one
  if (wasOccupyingSlot && ctx.config.simultaneousSeed !== -1) {
    activateNextQueued(ctx);
  }
}

/** Throws on anything except the file already being gone, which is the goal. */
function deleteTorrentFile(filePath: string, name: string): void {
  try {
    unlinkSync(filePath);
    logger.info({ name, filePath }, 'Torrent file deleted');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.error({ error, filePath }, 'Failed to delete the torrent file');
    throw error;
  }
}
