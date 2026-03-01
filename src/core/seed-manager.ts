import { EventEmitter } from 'node:events';
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import {
  loadConfig,
  saveConfig,
  loadState,
  saveState,
  CLIENTS_DIR,
  TORRENTS_DIR,
  listClientFiles,
} from '../config/config.js';
import type {
  AppConfig,
  SeedState,
  TorrentRuntimeState,
  TorrentSeedState,
  SeedrStatus,
  AnnounceEvent,
  ClientProfile,
} from '../config/types.js';
import { parseTorrentFile, infoHashToHex } from './torrent-parser.js';
import { loadClientProfile, generateKey, generatePeerId, type EmulatorState } from './client-emulator.js';
import { BandwidthDispatcher } from './bandwidth-dispatcher.js';
import { Scheduler } from './scheduler.js';
import { performAnnounce } from './announcer.js';
import { ConnectionHandler } from './connection-handler.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('seed-manager');

const STATE_SAVE_INTERVAL = 60000; // Save state every 60 seconds
const POLL_INTERVAL = 1000; // Check scheduler every second

export class SeedManager extends EventEmitter {
  private config!: AppConfig;
  private state!: SeedState;
  private profile!: ClientProfile;
  private bandwidth!: BandwidthDispatcher;
  private scheduler = new Scheduler();
  private connection = new ConnectionHandler();
  private torrents = new Map<string, TorrentRuntimeState>();
  private emulatorStates = new Map<string, EmulatorState>();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stateSaveTimer: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: FSWatcher | null = null;
  private startTime = 0;

  async init(): Promise<void> {
    this.config = loadConfig();
    this.state = loadState();

    // Load client profile
    const clientPath = join(CLIENTS_DIR, this.config.client);
    this.profile = loadClientProfile(clientPath);

    this.bandwidth = new BandwidthDispatcher(
      this.config.minUploadRate,
      this.config.maxUploadRate
    );

    // Scan torrents directory and start file watcher immediately
    // so the UI always reflects what's in the torrents folder
    this.scanTorrents();
    this.startFileWatcher();

    logger.info(
      { client: this.config.client, port: this.config.port },
      'SeedManager initialized'
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // Start connection handler (bind port, resolve IPs)
    await this.connection.start(this.config.port);

    // Start bandwidth dispatcher
    this.bandwidth.start();

    // Register all existing torrents with bandwidth dispatcher and schedule announces
    for (const [hash, torrent] of this.torrents) {
      torrent.seeding = false; // Reset seeding state — must announce first
      this.bandwidth.registerTorrent({
        infoHash: hash,
        seeders: torrent.seeders,
        leechers: torrent.leechers,
        active: torrent.active,
        eligible: false, // Not eligible until first successful announce
      });
      if (torrent.active) {
        this.scheduler.schedule(hash, 0); // Schedule initial announce
      }
    }

    // Start scheduler polling
    this.pollTimer = setInterval(() => this.pollScheduler(), POLL_INTERVAL);

    // Start state persistence
    this.stateSaveTimer = setInterval(() => {
      this.persistState();
    }, STATE_SAVE_INTERVAL);

    this.emit('started');
    logger.info({ port: this.connection.port, ip: this.connection.externalIp }, 'Seeding started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    logger.info('Stopping seed manager...');

    // Stop timers
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.stateSaveTimer) {
      clearInterval(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }

    // Send stopped announces for all active torrents
    const stopPromises: Promise<void>[] = [];
    for (const [hash, torrent] of this.torrents) {
      if (torrent.active && torrent.lastEvent !== 'stopped') {
        stopPromises.push(this.announceForTorrent(hash, 'stopped'));
      }
    }

    // Wait for all stopped announces (with timeout)
    await Promise.allSettled(stopPromises);

    // Stop subsystems
    this.bandwidth.stop();
    this.scheduler.clear();
    await this.connection.stop();

    // Save state
    this.persistState();

    this.emit('stopped');
    logger.info('Seed manager stopped');
  }

  private scanTorrents(): void {
    if (!existsSync(TORRENTS_DIR)) return;

    const files = readdirSync(TORRENTS_DIR).filter((f) => f.endsWith('.torrent'));

    for (const file of files) {
      const filePath = join(TORRENTS_DIR, file);
      this.addTorrent(filePath);
    }

    logger.info({ count: files.length }, 'Scanned torrents directory');
  }

  private startFileWatcher(): void {
    const watchPath = join(TORRENTS_DIR, '*.torrent');
    this.fileWatcher = chokidarWatch(watchPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
    });

    this.fileWatcher.on('add', (filePath: string) => {
      logger.info({ file: basename(filePath) }, 'Torrent file detected');
      this.addTorrent(filePath);
    });

    this.fileWatcher.on('unlink', (filePath: string) => {
      // Find and remove the torrent by file path
      for (const [hash, torrent] of this.torrents) {
        if (torrent.meta.filePath === filePath) {
          logger.info({ file: basename(filePath) }, 'Torrent file removed');
          this.removeTorrent(hash);
          break;
        }
      }
    });

    logger.info('File watcher started on torrents directory');
  }

  addTorrent(filePath: string): boolean {
    try {
      const meta = parseTorrentFile(filePath);
      const hexHash = infoHashToHex(meta.infoHash);

      if (this.torrents.has(hexHash)) {
        logger.debug({ name: meta.name }, 'Torrent already loaded');
        return false;
      }

      // Check simultaneous seed limit (-1 = unlimited)
      const activeCount = [...this.torrents.values()].filter((t) => t.active).length;
      const active = this.config.simultaneousSeed === -1 || activeCount < this.config.simultaneousSeed;

      // Restore or create seed state
      const seedState: TorrentSeedState = this.state.torrents[hexHash] || {
        infoHash: hexHash,
        uploaded: 0,
        downloaded: 0,
        lastAnnounce: 0,
        announceCount: 0,
      };

      // Generate initial key and peer ID
      const key = generateKey(this.profile.keyGenerator);
      const peerId = generatePeerId(this.profile.peerIdGenerator);

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
        nextAnnounce: Date.now(),
        seeders: 0,
        leechers: 0,
        uploadRate: 0,
        consecutiveFailures: 0,
        announceCount: seedState.announceCount,
        lastEvent: '' as AnnounceEvent,
        active,
        seeding: false, // Not seeding until first successful announce
      };

      this.torrents.set(hexHash, runtimeState);
      this.emulatorStates.set(hexHash, emulatorState);

      // If engine is running, register with bandwidth dispatcher and schedule announce
      if (this.running) {
        this.bandwidth.registerTorrent({
          infoHash: hexHash,
          seeders: 0,
          leechers: 0,
          active,
          eligible: false, // Not eligible until first successful announce
        });

        // Schedule initial announce (started event)
        if (active) {
          this.scheduler.schedule(hexHash, 0); // Immediately
        }
      }

      this.emit('torrent:added', { infoHash: hexHash, name: meta.name });
      logger.info({ name: meta.name, hash: hexHash.slice(0, 8), active }, 'Torrent added');

      return true;
    } catch (error) {
      logger.error({ filePath, error }, 'Failed to add torrent');
      return false;
    }
  }

  removeTorrent(infoHash: string): void {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) return;

    // Send stopped announce if active
    if (torrent.active && torrent.lastEvent !== 'stopped') {
      this.announceForTorrent(infoHash, 'stopped').catch(() => {});
    }

    this.scheduler.remove(infoHash);
    this.bandwidth.removeTorrent(infoHash);
    this.torrents.delete(infoHash);
    this.emulatorStates.delete(infoHash);
    delete this.state.torrents[infoHash];

    this.emit('torrent:removed', { infoHash });
    logger.info({ name: torrent.meta.name }, 'Torrent removed');
  }

  private async pollScheduler(): Promise<void> {
    if (!this.running) return;

    const dueTasks = this.scheduler.getDueTasks();

    for (const task of dueTasks) {
      const torrent = this.torrents.get(task.infoHash);
      if (!torrent || !torrent.active) continue;

      const event: AnnounceEvent =
        torrent.lastEvent === '' || torrent.lastEvent === 'stopped' ? 'started' : '';

      // Don't await — let announces run concurrently
      this.announceForTorrent(task.infoHash, event).catch((err) => {
        logger.error({ infoHash: task.infoHash, error: err }, 'Announce poll error');
      });
    }
  }

  private async announceForTorrent(infoHash: string, event: AnnounceEvent): Promise<void> {
    const torrent = this.torrents.get(infoHash);
    const emState = this.emulatorStates.get(infoHash);
    if (!torrent || !emState) return;

    // Calculate upload delta from bandwidth dispatcher
    let uploadDelta = 0;
    if (event !== 'started' && event !== 'stopped') {
      const eligible = this.isTorrentEligible(torrent);
      if (eligible) {
        uploadDelta = this.bandwidth.consumeAccumulated(infoHash);
      }
    }

    const result = await performAnnounce(
      torrent.meta,
      torrent.seedState,
      emState,
      this.profile,
      event,
      this.connection.port,
      uploadDelta,
      this.connection.externalIp ?? undefined,
      this.connection.externalIpv6 ?? undefined,
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

      // Update bandwidth dispatcher: now eligible based on peer counts
      const eligible = this.isTorrentEligible(torrent);
      this.bandwidth.updateTorrent(infoHash, {
        seeders: result.response.seeders,
        leechers: result.response.leechers,
        eligible,
      });

      // Update state for persistence
      this.state.torrents[infoHash] = torrent.seedState;

      this.emit('announce:success', {
        infoHash,
        tracker: result.trackerUrl,
        seeders: result.response.seeders,
        leechers: result.response.leechers,
        uploaded: torrent.seedState.uploaded,
      });

      // Check upload ratio target
      if (this.hasReachedRatioTarget(torrent)) {
        this.deactivateTorrent(infoHash, 'Upload ratio target reached');
        return;
      }

      // Check keepTorrentWithZeroLeechers
      if (!this.config.keepTorrentWithZeroLeechers && result.response.leechers === 0) {
        this.deactivateTorrent(infoHash, 'No leechers');
        return;
      }
    } else {
      // Failed announce — not seeding, not eligible for bandwidth
      torrent.seeding = false;
      this.bandwidth.updateTorrent(infoHash, { eligible: false });

      this.emit('announce:failure', {
        infoHash,
        tracker: result.trackerUrl,
        error: result.error,
      });
    }

    // Schedule next announce (unless stopped)
    if (event !== 'stopped' && torrent.active) {
      const intervalMs = torrent.interval * 1000;
      // Backoff on failures
      const backoff = result.success ? 1 : Math.min(Math.pow(2, torrent.consecutiveFailures), 32);
      this.scheduler.schedule(infoHash, intervalMs * backoff);
    }
  }

  private isTorrentEligible(torrent: TorrentRuntimeState): boolean {
    // skipIfNoPeers: if no peers at all, don't report upload
    if (this.config.skipIfNoPeers && torrent.seeders + torrent.leechers === 0) {
      return false;
    }

    // minLeechers check
    if (torrent.leechers < this.config.minLeechers) {
      return false;
    }

    return true;
  }

  /**
   * Check if a torrent has reached its upload ratio target.
   * Returns true if the torrent should be deactivated.
   */
  private hasReachedRatioTarget(torrent: TorrentRuntimeState): boolean {
    if (this.config.uploadRatioTarget <= 0) return false; // -1 = unlimited
    if (torrent.meta.totalSize === 0) return false;
    const ratio = torrent.seedState.uploaded / torrent.meta.totalSize;
    return ratio >= this.config.uploadRatioTarget;
  }

  /**
   * Deactivate a torrent and send a stopped announce.
   */
  private deactivateTorrent(infoHash: string, reason: string): void {
    const torrent = this.torrents.get(infoHash);
    if (!torrent || !torrent.active) return;

    torrent.active = false;
    torrent.seeding = false;
    this.bandwidth.updateTorrent(infoHash, { active: false, eligible: false });
    this.scheduler.remove(infoHash);

    // Send stopped announce
    this.announceForTorrent(infoHash, 'stopped').catch(() => {});

    logger.info({ name: torrent.meta.name, reason }, 'Torrent deactivated');
    this.emit('torrent:deactivated', { infoHash, name: torrent.meta.name, reason });
  }

  private persistState(): void {
    // Update all seed states
    for (const [hash, torrent] of this.torrents) {
      this.state.torrents[hash] = torrent.seedState;
    }
    saveState(this.state);
  }

  // ── Public API ──

  getConfig(): AppConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
    const oldClient = this.config.client;
    const oldPort = this.config.port;

    Object.assign(this.config, updates);
    saveConfig(this.config);

    // If client changed, reload profile and regenerate peer IDs/keys
    if (updates.client && updates.client !== oldClient) {
      const clientPath = join(CLIENTS_DIR, this.config.client);
      this.profile = loadClientProfile(clientPath);

      // Regenerate peer IDs and keys for all torrents with the new profile
      for (const [hash, emState] of this.emulatorStates) {
        emState.peerId = generatePeerId(this.profile.peerIdGenerator);
        emState.key = generateKey(this.profile.keyGenerator);
        const torrent = this.torrents.get(hash);
        if (torrent) {
          torrent.peerId = emState.peerId;
          torrent.key = emState.key;
        }
      }
    }

    // Update bandwidth rates
    if (updates.minUploadRate !== undefined || updates.maxUploadRate !== undefined) {
      this.bandwidth.updateRates(this.config.minUploadRate, this.config.maxUploadRate);
    }

    // If port changed and engine is running, restart connection handler
    if (updates.port !== undefined && updates.port !== oldPort && this.running) {
      await this.connection.stop();
      await this.connection.start(this.config.port);
      logger.info({ port: this.connection.port }, 'Port changed — connection handler restarted');
    }

    // If simultaneousSeed changed, activate/deactivate torrents accordingly
    if (updates.simultaneousSeed !== undefined) {
      const active = [...this.torrents.values()].filter((t) => t.active);
      const inactive = [...this.torrents.values()].filter((t) => !t.active);
      const limit = this.config.simultaneousSeed;

      if (limit === -1) {
        // Unlimited — activate all inactive torrents
        for (const t of inactive) {
          t.active = true;
          const hash = infoHashToHex(t.meta.infoHash);
          this.bandwidth.updateTorrent(hash, { active: true, eligible: true });
          this.scheduler.schedule(hash, 0);
        }
      } else if (active.length > limit) {
        // Deactivate excess torrents
        const excess = active.slice(limit);
        for (const t of excess) {
          t.active = false;
          const hash = infoHashToHex(t.meta.infoHash);
          this.bandwidth.updateTorrent(hash, { active: false });
          this.scheduler.remove(hash);
        }
      } else if (active.length < limit && inactive.length > 0) {
        // Activate more torrents
        const slotsAvailable = limit - active.length;
        const toActivate = inactive.slice(0, slotsAvailable);
        for (const t of toActivate) {
          t.active = true;
          const hash = infoHashToHex(t.meta.infoHash);
          this.bandwidth.updateTorrent(hash, { active: true, eligible: true });
          this.scheduler.schedule(hash, 0);
        }
      }
    }

    this.emit('config:updated', this.config);
    return { ...this.config };
  }

  getStatus(): SeedrStatus {
    const allocations = this.bandwidth.getAllocations();
    const allocMap = new Map(allocations.map((a) => [a.infoHash, a.bytesPerSecond]));

    const torrentStates = [...this.torrents.values()].map((t) => {
      const hexHash = infoHashToHex(t.meta.infoHash);
      const unreported = this.bandwidth.getAccumulated(hexHash);
      return {
        ...t,
        uploadRate: allocMap.get(hexHash) || 0,
        reportedUploaded: t.seedState.uploaded, // What the tracker knows
        seedState: {
          ...t.seedState,
          uploaded: t.seedState.uploaded + unreported, // Real-time local total
        },
      };
    });

    return {
      running: this.running,
      externalIp: this.connection.externalIp,
      externalIpv6: this.connection.externalIpv6,
      port: this.connection.port,
      client: this.config.client,
      globalUploadRate: this.bandwidth.getGlobalRate(),
      torrents: torrentStates,
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }

  getTorrentList(): Array<{
    infoHash: string;
    name: string;
    size: number;
    uploaded: number;
    reportedUploaded: number;
    seeders: number;
    leechers: number;
    active: boolean;
    seeding: boolean;
    tracker: string;
  }> {
    return [...this.torrents.entries()].map(([hash, t]) => {
      const unreported = this.running ? this.bandwidth.getAccumulated(hash) : 0;
      return {
        infoHash: hash,
        name: t.meta.name,
        size: t.meta.totalSize,
        uploaded: t.seedState.uploaded + unreported,
        reportedUploaded: t.seedState.uploaded,
        seeders: t.seeders,
        leechers: t.leechers,
        active: t.active,
        seeding: t.seeding,
        tracker: t.currentTracker,
      };
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getClientFiles(): string[] {
    return listClientFiles();
  }
}
