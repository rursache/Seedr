import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENTS_DIR, saveConfig } from '../../config/config.js';
import type { AppConfig } from '../../config/types.js';
import { createLogger } from '../../utils/logger.js';
import { loadClientProfile } from '../client-emulator/profile-loader.js';
import { generateKey, generatePeerId } from '../client-emulator/generators.js';
import { checkRatioTarget, checkTorrentEligible } from './announce-policy.js';
import type { SeedContext } from './context.js';

const logger = createLogger('config-updater');

/**
 * Rebind the listening port, restoring the previous one if the new port can't
 * be bound so a bad port change never leaves the engine without a socket.
 */
async function restartConnectionWithRollback(
  ctx: SeedContext,
  oldPort: number,
  newPort: number
): Promise<void> {
  await ctx.connection.stop();

  try {
    await ctx.connection.start(newPort);
    ctx.connection.setContext(ctx.createConnectionContext());
    logger.info({ port: ctx.connection.port }, 'Port changed — connection handler restarted');
    ctx.runPortCheck();
  } catch (err) {
    try {
      await ctx.connection.start(oldPort);
      ctx.connection.setContext(ctx.createConnectionContext());
      logger.warn({ port: oldPort }, 'Restored previous port after failed port change');
    } catch (rollbackErr) {
      logger.error(
        { err: rollbackErr, port: oldPort },
        'Failed to restore previous port after port change error'
      );
    }
    throw err;
  }
}

/**
 * Apply a config patch. Side effects that can fail (client profile load, port
 * rebind) run before any state is mutated, so a rejected update leaves the
 * engine exactly as it was and nothing is persisted.
 */
export async function updateConfig(
  ctx: SeedContext,
  updates: Partial<AppConfig>
): Promise<AppConfig> {
  const oldConfig = { ...ctx.config };
  const oldClient = oldConfig.client;
  const oldPort = oldConfig.port;
  const nextConfig = { ...oldConfig, ...updates };
  const clientChanged = !!updates.client && updates.client !== oldClient;
  let nextProfile = ctx.profile;
  const regeneratedStates = new Map<string, { peerId: Buffer; key: string }>();

  // Validate client file exists before applying any changes
  if (clientChanged) {
    const clientPath = join(CLIENTS_DIR, nextConfig.client);
    if (!existsSync(clientPath)) {
      throw new Error(`Client profile not found: ${nextConfig.client}`);
    }

    nextProfile = loadClientProfile(clientPath);

    // Precompute regenerated peer IDs and keys so config mutation stays atomic.
    for (const [hash] of ctx.emulatorStates) {
      regeneratedStates.set(hash, {
        peerId: generatePeerId(nextProfile.peerIdGenerator),
        key: generateKey(nextProfile.keyGenerator),
      });
    }
  }

  // If port changed and engine is running, restart connection handler
  if (updates.port !== undefined && updates.port !== oldPort && ctx.running) {
    await restartConnectionWithRollback(ctx, oldPort, nextConfig.port);
  }

  // Low-risk runtime state updates happen only after risky side effects succeed.
  ctx.config = nextConfig;

  if (clientChanged) {
    ctx.profile = nextProfile;
    for (const [hash, emState] of ctx.emulatorStates) {
      const regenerated = regeneratedStates.get(hash);
      if (!regenerated) continue;
      emState.peerId = regenerated.peerId;
      emState.key = regenerated.key;
      const torrent = ctx.torrents.get(hash);
      if (torrent) {
        torrent.peerId = regenerated.peerId;
        torrent.key = regenerated.key;
      }
    }
  }

  if (updates.minUploadRate !== undefined || updates.maxUploadRate !== undefined) {
    ctx.bandwidth.updateRates(nextConfig.minUploadRate, nextConfig.maxUploadRate);
  }

  // If simultaneousSeed changed, activate/deactivate torrents accordingly
  if (updates.simultaneousSeed !== undefined) {
    ctx.rebalanceActiveTorrents();
  }

  // Restart rotation timer if rotation-related settings changed
  if (
    (updates.seedRotationInterval !== undefined || updates.simultaneousSeed !== undefined) &&
    ctx.running
  ) {
    ctx.startRotationTimer();
  }

  // Re-evaluate completed state when uploadRatioTarget changes and repair
  // slot assignment in case torrents cross the threshold in either direction.
  if (updates.uploadRatioTarget !== undefined) {
    for (const [hash, torrent] of ctx.torrents) {
      const completed = checkRatioTarget(ctx.config, torrent);
      if (torrent.completed !== completed) {
        torrent.completed = completed;
        logger.info(
          { name: torrent.meta.name, completed },
          completed
            ? 'Torrent completed by ratio target update'
            : 'Torrent un-completed by ratio target update'
        );
      }
      ctx.bandwidth.updateTorrent(hash, { eligible: checkTorrentEligible(ctx.config, torrent) });
    }
    ctx.rebalanceActiveTorrents();
  }

  // Re-evaluate eligibility when peer-related settings change
  if (
    updates.keepTorrentWithZeroLeechers !== undefined ||
    updates.skipIfNoPeers !== undefined ||
    updates.minLeechers !== undefined ||
    updates.minSeeders !== undefined
  ) {
    for (const [hash, torrent] of ctx.torrents) {
      ctx.bandwidth.updateTorrent(hash, { eligible: checkTorrentEligible(ctx.config, torrent) });
    }
  }

  // Persist config only after all side effects have succeeded
  saveConfig(nextConfig);

  ctx.emit('config:updated', nextConfig);
  return { ...nextConfig };
}
