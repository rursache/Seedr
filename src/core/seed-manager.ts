import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { type FSWatcher } from 'chokidar';
import { loadConfig, loadState, saveState, CLIENTS_DIR, listClientFiles } from '../config/config.js';
import type {
  AppConfig,
  SeedState,
  TorrentRuntimeState,
  SeedrStatus,
  TorrentListItem,
  AnnounceEvent,
  ClientProfile,
  EmulatorState,
  PortCheckStatus,
} from '../config/types.js';
import { loadClientProfile } from './client-emulator/profile-loader.js';
import { BandwidthDispatcher } from './bandwidth-dispatcher.js';
import { Scheduler } from './scheduler.js';
import { ConnectionHandler, type ConnectionContext } from './connection-handler.js';
import { EventLog } from './event-log.js';
import { checkPortReachable } from '../utils/port-checker.js';
import { getDemoStatus, getDemoTorrentList } from '../demo/demo-data.js';
import { createLogger } from '../utils/logger.js';
import type { SeedContext } from './seeding/context.js';
import { checkRatioTarget } from './seeding/announce-policy.js';
import { announceForTorrent, pollScheduler } from './seeding/announce-runner.js';
import { rebalanceActiveTorrents, rotateTorrents } from './seeding/slot-manager.js';
import { addTorrent, removeTorrent, scanTorrents } from './seeding/torrent-registry.js';
import { startTorrentWatcher } from './seeding/torrent-watcher.js';
import { buildStatus, buildTorrentList } from './seeding/status-view.js';
import { updateConfig } from './seeding/config-updater.js';

const logger = createLogger('seed-manager');

const STATE_SAVE_INTERVAL = 60_000; // Save state every 60 seconds
const POLL_INTERVAL = 1_000; // Check scheduler every second
const STOP_ANNOUNCE_TIMEOUT = 10_000; // 10s timeout for stop announces

/**
 * Owns the engine's lifecycle and state. The actual seeding behaviour lives in
 * ./seeding, which operates on this instance through the SeedContext interface
 * — hence the public-but-internal fields below.
 */
export class SeedManager extends EventEmitter implements SeedContext {
  config!: AppConfig;
  state!: SeedState;
  profile!: ClientProfile;
  bandwidth!: BandwidthDispatcher;
  scheduler = new Scheduler();
  readonly eventLog = new EventLog();
  connection = new ConnectionHandler();
  torrents = new Map<string, TorrentRuntimeState>();
  emulatorStates = new Map<string, EmulatorState>();
  announceLocks = new Map<string, Promise<void>>(); // per-torrent announce lock
  activatedAt = new Map<string, number>(); // hash -> timestamp when torrent became active
  running = false;

  private stopping = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stateSaveTimer: ReturnType<typeof setInterval> | null = null;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: FSWatcher | null = null;
  private startTime = 0;
  private portCheckResult: PortCheckStatus = { result: null, error: null, checking: false };
  readonly demoMode: boolean;

  constructor(demoMode = false) {
    super();
    this.demoMode = demoMode;
  }

  async init(): Promise<void> {
    this.config = loadConfig();
    this.state = loadState();
    this.profile = loadClientProfile(join(CLIENTS_DIR, this.config.client));

    this.bandwidth = new BandwidthDispatcher(this.config.minUploadRate, this.config.maxUploadRate);

    if (!this.demoMode) {
      // Scan torrents directory and start file watcher immediately
      // so the UI always reflects what's in the torrents folder
      this.scanTorrents();
      this.startFileWatcher();
    }

    logger.info(
      { client: this.config.client, port: this.config.port, demoMode: this.demoMode },
      'SeedManager initialized'
    );
  }

  async start(): Promise<void> {
    if (this.running || this.stopping) return;
    this.startTime = Date.now();

    for (const torrent of this.torrents.values()) {
      // Reset runtime state for fresh session
      torrent.seeding = false;
      torrent.lastEvent = '' as AnnounceEvent;
      torrent.consecutiveFailures = 0;
      torrent.lastFailureTransient = false;
      // Re-evaluate completed (ratio may still be met from persisted state)
      torrent.completed = checkRatioTarget(this.config, torrent);
    }

    // Recompute slot assignment before any timers or network activity start.
    // This repairs gaps created while stopped and lets completed torrents stop
    // occupying limited active slots.
    this.rebalanceActiveTorrents();

    try {
      // Start connection handler (bind port, resolve IPs)
      await this.connection.start(this.config.port);

      // Provide torrent context so incoming BT handshakes can be answered
      this.connection.setContext(this.createConnectionContext());

      this.running = true;
      this.bandwidth.start();

      // Register all existing torrents with bandwidth dispatcher and schedule announces
      for (const [hash, torrent] of this.torrents) {
        this.bandwidth.registerTorrent({
          infoHash: hash,
          seeders: torrent.seeders,
          leechers: torrent.leechers,
          active: torrent.active,
          eligible: false, // Not eligible until first successful announce
        });
        if (torrent.active) {
          this.activatedAt.set(hash, Date.now());
          this.scheduler.schedule(hash, 0); // Schedule initial announce
        }
      }

      this.startRotationTimer();
      this.pollTimer = setInterval(() => pollScheduler(this), POLL_INTERVAL);
      this.stateSaveTimer = setInterval(() => this.persistState(), STATE_SAVE_INTERVAL);

      this.emit('started');
      logger.info({ port: this.connection.port, ip: this.connection.externalIp }, 'Seeding started');

      // Run port check in background after start
      this.runPortCheck();
    } catch (err) {
      this.running = false;
      this.activatedAt.clear();
      this.scheduler.clear();
      this.clearTimers();

      try {
        this.bandwidth.stop();
      } catch {
        // Best-effort cleanup after a partial startup failure.
      }

      try {
        await this.connection.stop();
      } catch (stopErr) {
        logger.error({ err: stopErr }, 'Failed to roll back connection handler after startup failure');
      }

      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    this.running = false;

    logger.info('Stopping seed manager...');

    this.clearTimers();

    // Send stopped announces for all active torrents (with 10s timeout)
    const stopPromises: Promise<void>[] = [];
    for (const [hash, torrent] of this.torrents) {
      if (torrent.active && torrent.lastEvent !== 'stopped') {
        stopPromises.push(this.announceForTorrent(hash, 'stopped'));
      }
    }

    if (stopPromises.length > 0) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_ANNOUNCE_TIMEOUT));
      await Promise.race([Promise.allSettled(stopPromises), timeout]);
    }

    this.bandwidth.stop();
    this.scheduler.clear();
    await this.connection.stop();

    this.persistState();

    this.stopping = false;
    this.emit('stopped');
    logger.info('Seed manager stopped');
  }

  /**
   * Clean up resources (file watcher, etc.) on process shutdown.
   */
  async destroy(): Promise<void> {
    if (this.running) await this.stop();
    this.eventLog.destroy();
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.stateSaveTimer) {
      clearInterval(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }
    this.stopRotationTimer();
  }

  startRotationTimer(): void {
    this.stopRotationTimer();
    if (this.config.seedRotationInterval > 0 && this.config.simultaneousSeed !== -1) {
      this.rotationTimer = setInterval(
        () => rotateTorrents(this),
        this.config.seedRotationInterval * 60 * 1000
      );
      logger.info({ intervalMin: this.config.seedRotationInterval }, 'Rotation timer started');
    }
  }

  private stopRotationTimer(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  private startFileWatcher(): void {
    this.fileWatcher = startTorrentWatcher({
      onAdd: (filePath) => this.addTorrent(filePath),
      onRemove: (filePath) => {
        for (const [hash, torrent] of this.torrents) {
          if (torrent.meta.filePath === filePath) {
            logger.info({ name: torrent.meta.name }, 'Torrent file removed');
            this.removeTorrent(hash);
            break;
          }
        }
      },
    });
  }

  async runPortCheck(): Promise<void> {
    const ip = this.connection.externalIp;
    const port = this.connection.port;
    if (!ip || port <= 0) return;

    this.portCheckResult = { result: null, error: null, checking: true };
    try {
      const result = await checkPortReachable(ip, port);
      this.portCheckResult = { result, error: null, checking: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.portCheckResult = { result: null, error: msg, checking: false };
    }
  }

  createConnectionContext(): ConnectionContext {
    return {
      getInfoHashes: () => {
        const hashes = new Set<string>();
        for (const [hash, torrent] of this.torrents) {
          if (torrent.active) hashes.add(hash);
        }
        return hashes;
      },
      getPeerId: (infoHash: string) => this.emulatorStates.get(infoHash)?.peerId ?? null,
    };
  }

  private persistState(): void {
    for (const [hash, torrent] of this.torrents) {
      this.state.torrents[hash] = torrent.seedState;
    }
    saveState(this.state);
  }

  // ── Delegated to ./seeding ──

  announceForTorrent(infoHash: string, event: AnnounceEvent): Promise<void> {
    return announceForTorrent(this, infoHash, event);
  }

  private scanTorrents(): void {
    scanTorrents(this);
  }

  rebalanceActiveTorrents(): void {
    rebalanceActiveTorrents(this);
  }

  // ── Public API ──

  addTorrent(filePath: string): boolean {
    return addTorrent(this, filePath);
  }

  async removeTorrent(infoHash: string, deleteFile = false): Promise<void> {
    return removeTorrent(this, infoHash, deleteFile);
  }

  getConfig(): AppConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
    return updateConfig(this, updates);
  }

  getStatus(): SeedrStatus {
    if (this.demoMode) return getDemoStatus();
    return buildStatus(this, { startTime: this.startTime, portCheck: this.portCheckResult });
  }

  getTorrentList(): TorrentListItem[] {
    if (this.demoMode) return getDemoTorrentList();
    return buildTorrentList(this);
  }

  /**
   * Force an immediate announce for a specific torrent.
   */
  async forceAnnounce(infoHash: string): Promise<boolean> {
    if (!this.running) return false;
    const torrent = this.torrents.get(infoHash);
    if (!torrent || !torrent.active) return false;

    const event = torrent.lastEvent === '' || torrent.lastEvent === 'stopped' ? 'started' : '';
    await this.announceForTorrent(infoHash, event as AnnounceEvent);
    return true;
  }

  isRunning(): boolean {
    return this.running;
  }

  getClientFiles(): string[] {
    return listClientFiles();
  }
}
