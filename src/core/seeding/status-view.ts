import { basename } from 'node:path';
import type { PortCheckStatus, SeedrStatus, TorrentListItem } from '../../config/types.js';
import { infoHashToHex } from '../torrent-parser.js';
import type { SeedContext } from './context.js';

export interface StatusExtras {
  startTime: number;
  portCheck: PortCheckStatus;
}

/**
 * Uploaded totals shown to the user include bytes the dispatcher has simulated
 * but not yet reported to the tracker, so the number moves between announces.
 */
export function buildStatus(ctx: SeedContext, extras: StatusExtras): SeedrStatus {
  const torrents = [...ctx.torrents.values()].map((t) => {
    const hexHash = infoHashToHex(t.meta.infoHash);
    const unreported = ctx.bandwidth.getAccumulated(hexHash);
    return {
      ...t,
      // Hex encoded so the payload stays plain JSON — see TorrentStatusView
      meta: { ...t.meta, infoHash: hexHash },
      peerId: t.peerId.toString('hex'),
      uploadRate: ctx.bandwidth.getActualTorrentRate(hexHash),
      reportedUploaded: t.seedState.uploaded, // What the tracker knows
      seedState: {
        ...t.seedState,
        uploaded: t.seedState.uploaded + unreported, // Real-time local total
      },
    };
  });

  return {
    running: ctx.running,
    externalIp: ctx.connection.externalIp,
    externalIpv6: ctx.connection.externalIpv6,
    port: ctx.connection.port,
    client: ctx.config.client,
    globalUploadRate: ctx.bandwidth.getGlobalRate(),
    actualUploadRate: ctx.bandwidth.getActualRate(),
    torrents,
    uptime: ctx.running ? Date.now() - extras.startTime : 0,
    portCheck: extras.portCheck,
  };
}

export function buildTorrentList(ctx: SeedContext): TorrentListItem[] {
  return [...ctx.torrents.entries()].map(([hash, t], i) => {
    const unreported = ctx.running ? ctx.bandwidth.getAccumulated(hash) : 0;
    return {
      infoHash: hash,
      name: t.meta.name,
      fileName: basename(t.meta.filePath),
      size: t.meta.totalSize,
      uploaded: t.seedState.uploaded + unreported,
      reportedUploaded: t.seedState.uploaded,
      seeders: t.seeders,
      leechers: t.leechers,
      active: t.active,
      seeding: t.seeding,
      completed: t.completed,
      lastFailureTransient: t.lastFailureTransient,
      tracker: t.currentTracker,
      uploadRate: ctx.running ? ctx.bandwidth.getActualTorrentRate(hash) : 0,
      consecutiveFailures: t.consecutiveFailures,
      addedIndex: i,
    };
  });
}
