import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('bandwidth');

export interface TorrentBandwidthInfo {
  infoHash: string;
  seeders: number;
  leechers: number;
  active: boolean;
  eligible: boolean; // meets minLeechers + skipIfNoPeers requirements
}

export interface BandwidthAllocation {
  infoHash: string;
  bytesPerSecond: number;
}

/**
 * Bandwidth dispatcher: simulates upload speed distribution across torrents.
 *
 * - Picks a random global speed within min/max range, drifts ±15% every ~3 min
 * - Weights torrents by peer ratio: sqrt(leechers/(seeders+leechers)) * leechers
 * - 10% floor per torrent to prevent starvation, 90% distributed by weight
 * - Adds +-10% jitter per tick
 * - Accumulates bytes every 1 second
 * - Tracks actual throughput per torrent and globally for real-time display
 */
export class BandwidthDispatcher extends EventEmitter {
  private minRate: number; // KB/s
  private maxRate: number; // KB/s
  private currentRateKBs: number = 0;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private torrents = new Map<string, TorrentBandwidthInfo>();
  private accumulated = new Map<string, number>(); // bytes accumulated per torrent
  private lastTickBytes: number = 0; // actual bytes dispatched in last tick
  private lastTickPerTorrent = new Map<string, number>(); // actual bytes/s per torrent from last tick

  constructor(minRate: number, maxRate: number) {
    super();
    this.minRate = minRate;
    this.maxRate = maxRate;
    this.refreshGlobalSpeed();
  }

  updateRates(minRate: number, maxRate: number): void {
    this.minRate = minRate;
    this.maxRate = maxRate;
    this.refreshGlobalSpeed();
  }

  private refreshGlobalSpeed(): void {
    if (this.maxRate <= this.minRate) {
      this.currentRateKBs = this.minRate;
    } else {
      this.currentRateKBs =
        this.minRate + Math.random() * (this.maxRate - this.minRate);
    }

    logger.debug({ rateKBs: this.currentRateKBs.toFixed(1) }, 'Global speed refreshed');
    this.emit('speed:updated', this.currentRateKBs);
  }

  /**
   * Drift the global speed by ±15% of the current value, clamped to min/max.
   * Produces gradual, realistic speed changes instead of sudden jumps.
   */
  private driftGlobalSpeed(): void {
    if (this.maxRate <= this.minRate) {
      this.currentRateKBs = this.minRate;
      return;
    }

    const drift = 0.85 + Math.random() * 0.30; // 0.85 – 1.15
    this.currentRateKBs = Math.max(this.minRate, Math.min(this.maxRate, this.currentRateKBs * drift));

    logger.debug({ rateKBs: this.currentRateKBs.toFixed(1) }, 'Global speed drifted');
    this.emit('speed:updated', this.currentRateKBs);
  }

  /**
   * Compute weight for a torrent based on peer counts.
   * Formula: sqrt(leechers / (seeders + leechers)) * leechers
   * Uses sqrt instead of squaring to avoid extreme skew.
   */
  private computeWeight(info: TorrentBandwidthInfo): number {
    if (!info.eligible || !info.active) return 0;
    const total = info.seeders + info.leechers;
    if (total === 0 || info.leechers === 0) return 0;

    const ratio = info.leechers / total;
    return Math.sqrt(ratio) * info.leechers;
  }

  /**
   * Distribute bandwidth across torrents, returning bytes/s per torrent.
   *
   * Each eligible torrent gets a guaranteed minimum floor (10% of an equal share),
   * then the remaining bandwidth is split by weight. This prevents any torrent
   * from being starved to near-zero.
   */
  private computeAllocations(): BandwidthAllocation[] {
    const eligible = [...this.torrents.values()].filter((t) => t.eligible && t.active);
    if (eligible.length === 0) return [];

    const totalBytes = this.currentRateKBs * 1024; // Convert KB/s to bytes/s
    const equalShare = totalBytes / eligible.length;
    const floorBytes = equalShare * 0.1; // 10% of equal share as guaranteed minimum
    const floorTotal = floorBytes * eligible.length;
    const weightedPool = totalBytes - floorTotal; // remaining 90% distributed by weight

    const weights = eligible.map((t) => ({
      infoHash: t.infoHash,
      weight: this.computeWeight(t),
    }));

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

    if (totalWeight === 0) {
      // Equal distribution if all weights are 0
      return eligible.map((t) => ({ infoHash: t.infoHash, bytesPerSecond: equalShare }));
    }

    return weights.map((w) => ({
      infoHash: w.infoHash,
      bytesPerSecond: floorBytes + (w.weight / totalWeight) * weightedPool,
    }));
  }

  /**
   * One-second tick: accumulate bytes with jitter.
   */
  private tick(): void {
    const allocations = this.computeAllocations();

    let tickTotal = 0;
    this.lastTickPerTorrent.clear();
    for (const alloc of allocations) {
      // Apply +-10% jitter
      const jitter = 0.9 + Math.random() * 0.2;
      const bytes = Math.floor(alloc.bytesPerSecond * jitter);
      tickTotal += bytes;
      this.lastTickPerTorrent.set(alloc.infoHash, bytes);

      const current = this.accumulated.get(alloc.infoHash) || 0;
      this.accumulated.set(alloc.infoHash, current + bytes);
    }

    this.lastTickBytes = tickTotal;
    this.emit('upload:accumulated', new Map(this.accumulated));
  }

  registerTorrent(info: TorrentBandwidthInfo): void {
    this.torrents.set(info.infoHash, info);
    if (!this.accumulated.has(info.infoHash)) {
      this.accumulated.set(info.infoHash, 0);
    }
  }

  updateTorrent(infoHash: string, update: Partial<TorrentBandwidthInfo>): void {
    const existing = this.torrents.get(infoHash);
    if (existing) {
      Object.assign(existing, update);
    }
  }

  removeTorrent(infoHash: string): void {
    this.torrents.delete(infoHash);
    this.accumulated.delete(infoHash);
  }

  /**
   * Get accumulated bytes for a torrent and reset the counter.
   */
  consumeAccumulated(infoHash: string): number {
    const bytes = this.accumulated.get(infoHash) || 0;
    this.accumulated.set(infoHash, 0);
    return bytes;
  }

  /**
   * Peek at accumulated bytes without consuming (for UI display).
   */
  getAccumulated(infoHash: string): number {
    return this.accumulated.get(infoHash) || 0;
  }

  /**
   * Restore bytes back to the accumulator (e.g., after a failed announce).
   */
  restoreAccumulated(infoHash: string, bytes: number): void {
    if (bytes <= 0) return;
    const current = this.accumulated.get(infoHash) || 0;
    this.accumulated.set(infoHash, current + bytes);
  }

  getGlobalRate(): number {
    // Return 0 if no torrents are eligible (nothing actually being uploaded)
    const hasEligible = [...this.torrents.values()].some((t) => t.eligible && t.active);
    return hasEligible ? this.currentRateKBs : 0;
  }

  /**
   * Get the actual throughput from the last tick (bytes/s).
   * This reflects real simulated bytes including jitter and weight distribution.
   */
  getActualRate(): number {
    return this.lastTickBytes;
  }

  /**
   * Get actual throughput for a specific torrent from the last tick (bytes/s).
   */
  getActualTorrentRate(infoHash: string): number {
    return this.lastTickPerTorrent.get(infoHash) || 0;
  }

  getAllocations(): BandwidthAllocation[] {
    return this.computeAllocations();
  }

  start(): void {
    if (this.tickInterval) return;

    this.refreshGlobalSpeed();

    // Tick every second for byte accumulation
    this.tickInterval = setInterval(() => this.tick(), 1000);

    // Drift global speed every ~3 minutes for gradual, realistic changes
    this.refreshInterval = setInterval(() => this.driftGlobalSpeed(), 3 * 60 * 1000);

    logger.info('Bandwidth dispatcher started');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    logger.info('Bandwidth dispatcher stopped');
  }
}
