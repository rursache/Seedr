import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { TORRENTS_DIR } from '../../config/config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('torrent-watcher');

export interface TorrentWatcherHandlers {
  onAdd(filePath: string): void;
  onRemove(filePath: string): void;
}

/**
 * Watch the torrents directory for .torrent files appearing or disappearing.
 * Bind mounts don't propagate inotify events, so containers fall back to polling.
 */
export function startTorrentWatcher(handlers: TorrentWatcherHandlers): FSWatcher {
  const inContainer = existsSync('/.dockerenv') || !!process.env['container'];
  const watcher = chokidarWatch(TORRENTS_DIR, {
    ignoreInitial: true,
    depth: 0,
    usePolling: inContainer,
    interval: 5000,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });
  logger.debug({ inContainer }, 'File watcher started');

  watcher.on('add', (filePath: string) => {
    if (!filePath.endsWith('.torrent')) return;
    logger.info({ file: basename(filePath) }, 'Torrent file detected');
    handlers.onAdd(filePath);
  });

  watcher.on('error', (err) => {
    logger.error({ err }, 'File watcher error');
  });

  watcher.on('unlink', (filePath: string) => {
    if (!filePath.endsWith('.torrent')) return;
    handlers.onRemove(filePath);
  });

  logger.info('File watcher started on torrents directory');
  return watcher;
}
