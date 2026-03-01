import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BandwidthDispatcher, type TorrentBandwidthInfo } from '../src/core/bandwidth-dispatcher.js';

describe('BandwidthDispatcher', () => {
  let dispatcher: BandwidthDispatcher;

  beforeEach(() => {
    dispatcher = new BandwidthDispatcher(100, 500);
  });

  afterEach(() => {
    dispatcher.stop();
  });

  it('should initialize with a speed in the configured range', () => {
    // getGlobalRate returns 0 when no eligible torrents exist
    expect(dispatcher.getGlobalRate()).toBe(0);

    // Register an eligible torrent — now the rate should reflect the configured range
    dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });
    const rate = dispatcher.getGlobalRate();
    expect(rate).toBeGreaterThanOrEqual(100);
    expect(rate).toBeLessThanOrEqual(500);
  });

  it('should compute correct weights based on peer ratio', () => {
    // Register two torrents with different peer distributions
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });
    dispatcher.registerTorrent({
      infoHash: 'bbb',
      seeders: 50,
      leechers: 2,
      active: true,
      eligible: true,
    });

    const allocations = dispatcher.getAllocations();
    expect(allocations).toHaveLength(2);

    // Torrent 'aaa' should get significantly more bandwidth (more leechers relative to seeders)
    const allocA = allocations.find((a) => a.infoHash === 'aaa')!;
    const allocB = allocations.find((a) => a.infoHash === 'bbb')!;
    expect(allocA.bytesPerSecond).toBeGreaterThan(allocB.bytesPerSecond);
  });

  it('should not allocate to ineligible torrents', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });
    dispatcher.registerTorrent({
      infoHash: 'bbb',
      seeders: 5,
      leechers: 0,
      active: true,
      eligible: false,
    });

    const allocations = dispatcher.getAllocations();
    const allocB = allocations.find((a) => a.infoHash === 'bbb');
    expect(allocB).toBeUndefined();
  });

  it('should not allocate to inactive torrents', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: false,
      eligible: true,
    });

    const allocations = dispatcher.getAllocations();
    expect(allocations).toHaveLength(0);
  });

  it('should accumulate and consume bytes', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });

    dispatcher.start();

    // Wait for a couple ticks
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const bytes = dispatcher.consumeAccumulated('aaa');
        expect(bytes).toBeGreaterThan(0);

        // After consuming, should reset to 0
        const bytesAfter = dispatcher.consumeAccumulated('aaa');
        expect(bytesAfter).toBe(0);

        resolve();
      }, 2500);
    });
  });

  it('should handle rate updates', () => {
    dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });
    dispatcher.updateRates(10, 20);
    const rate = dispatcher.getGlobalRate();
    expect(rate).toBeGreaterThanOrEqual(10);
    expect(rate).toBeLessThanOrEqual(20);
  });

  it('should remove torrents', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });

    dispatcher.removeTorrent('aaa');
    const allocations = dispatcher.getAllocations();
    expect(allocations).toHaveLength(0);
  });

  it('should return 0 global rate when no eligible torrents', () => {
    expect(dispatcher.getGlobalRate()).toBe(0);

    // Register an ineligible torrent — still 0
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: false,
    });
    expect(dispatcher.getGlobalRate()).toBe(0);
  });

  it('should return non-zero global rate when eligible torrent exists', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 0,
      leechers: 5,
      active: true,
      eligible: true,
    });
    expect(dispatcher.getGlobalRate()).toBeGreaterThan(0);
  });

  it('should give zero weight to torrents with zero leechers', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });
    dispatcher.registerTorrent({
      infoHash: 'bbb',
      seeders: 10,
      leechers: 0,
      active: true,
      eligible: true,
    });

    const allocations = dispatcher.getAllocations();
    // bbb has 0 leechers so its weight is 0, but it's still in the list (equal distrib fallback)
    const allocA = allocations.find((a) => a.infoHash === 'aaa')!;
    expect(allocA.bytesPerSecond).toBeGreaterThan(0);
  });

  it('should handle equal distribution when all weights are 0', () => {
    // Both torrents have 0 leechers → weight=0 → equal distribution
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 10,
      leechers: 0,
      active: true,
      eligible: true,
    });
    dispatcher.registerTorrent({
      infoHash: 'bbb',
      seeders: 20,
      leechers: 0,
      active: true,
      eligible: true,
    });

    const allocations = dispatcher.getAllocations();
    expect(allocations).toHaveLength(2);
    // Should be roughly equal
    expect(allocations[0]!.bytesPerSecond).toBeCloseTo(allocations[1]!.bytesPerSecond, -1);
  });

  it('should return 0 bytes for consuming unregistered torrent', () => {
    expect(dispatcher.consumeAccumulated('nonexistent')).toBe(0);
  });

  it('should handle updateTorrent on non-existent torrent gracefully', () => {
    // Should not throw
    expect(() => {
      dispatcher.updateTorrent('nonexistent', { eligible: true });
    }).not.toThrow();
  });

  it('should return 0 actual rate before any ticks', () => {
    expect(dispatcher.getActualRate()).toBe(0);
  });

  it('should track actual throughput after ticks', () => {
    dispatcher.registerTorrent({
      infoHash: 'aaa',
      seeders: 5,
      leechers: 10,
      active: true,
      eligible: true,
    });

    dispatcher.start();

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const rate = dispatcher.getActualRate();
        expect(rate).toBeGreaterThan(0);
        resolve();
      }, 1500);
    });
  });

  describe('driftGlobalSpeed', () => {
    it('should keep rate within min/max bounds after many drifts', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });

      // Call drift many times via updateRates (which calls refreshGlobalSpeed) + manual drift simulation
      // We test via repeated rate checks after updateRates triggers
      for (let i = 0; i < 100; i++) {
        // Trigger drift by starting/stopping (which calls refreshGlobalSpeed)
        dispatcher.updateRates(100, 500);
        const rate = dispatcher.getGlobalRate();
        expect(rate).toBeGreaterThanOrEqual(100);
        expect(rate).toBeLessThanOrEqual(500);
      }
    });

    it('should return minRate when min equals max', () => {
      const fixedDispatcher = new BandwidthDispatcher(300, 300);
      fixedDispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });
      expect(fixedDispatcher.getGlobalRate()).toBe(300);
      fixedDispatcher.updateRates(300, 300);
      expect(fixedDispatcher.getGlobalRate()).toBe(300);
      fixedDispatcher.stop();
    });
  });

  describe('restoreAccumulated', () => {
    it('should restore bytes back to accumulator', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });

      // Manually set some accumulated bytes then consume
      dispatcher.restoreAccumulated('aaa', 5000);
      expect(dispatcher.getAccumulated('aaa')).toBe(5000);

      // Consume and verify
      const consumed = dispatcher.consumeAccumulated('aaa');
      expect(consumed).toBe(5000);
      expect(dispatcher.getAccumulated('aaa')).toBe(0);

      // Restore after consume
      dispatcher.restoreAccumulated('aaa', 3000);
      expect(dispatcher.getAccumulated('aaa')).toBe(3000);
    });

    it('should add to existing accumulated bytes', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });

      dispatcher.restoreAccumulated('aaa', 1000);
      dispatcher.restoreAccumulated('aaa', 2000);
      expect(dispatcher.getAccumulated('aaa')).toBe(3000);
    });

    it('should no-op on zero bytes', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });

      dispatcher.restoreAccumulated('aaa', 1000);
      dispatcher.restoreAccumulated('aaa', 0);
      expect(dispatcher.getAccumulated('aaa')).toBe(1000);
    });

    it('should no-op on negative bytes', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });

      dispatcher.restoreAccumulated('aaa', 1000);
      dispatcher.restoreAccumulated('aaa', -500);
      expect(dispatcher.getAccumulated('aaa')).toBe(1000);
    });
  });

  describe('getActualTorrentRate', () => {
    it('should return 0 for unknown torrent', () => {
      expect(dispatcher.getActualTorrentRate('nonexistent')).toBe(0);
    });

    it('should return 0 before any ticks', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });
      expect(dispatcher.getActualTorrentRate('aaa')).toBe(0);
    });

    it('should return per-torrent throughput after ticks', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 5, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'bbb', seeders: 1, leechers: 10, active: true, eligible: true });
      dispatcher.start();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const rateA = dispatcher.getActualTorrentRate('aaa');
          const rateB = dispatcher.getActualTorrentRate('bbb');
          expect(rateA).toBeGreaterThan(0);
          expect(rateB).toBeGreaterThan(0);
          // Combined should roughly equal global actual rate
          const total = dispatcher.getActualRate();
          expect(rateA + rateB).toBeCloseTo(total, -2);
          resolve();
        }, 1500);
      });
    });
  });

  describe('10% floor allocation', () => {
    it('should guarantee minimum bandwidth even with extreme weight difference', () => {
      // Torrent A: many leechers, high weight. Torrent B: few leechers, low weight.
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 1, leechers: 100, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'bbb', seeders: 100, leechers: 1, active: true, eligible: true });

      const allocations = dispatcher.getAllocations();
      const allocA = allocations.find((a) => a.infoHash === 'aaa')!;
      const allocB = allocations.find((a) => a.infoHash === 'bbb')!;

      // B should get at least the 10% floor (5% of total since 2 torrents)
      const totalBandwidth = allocA.bytesPerSecond + allocB.bytesPerSecond;
      expect(allocB.bytesPerSecond).toBeGreaterThan(0);
      // Floor is 10% of equal share = 10% * 50% = 5% of total
      expect(allocB.bytesPerSecond / totalBandwidth).toBeGreaterThanOrEqual(0.04); // ~5% with rounding
    });

    it('should sum allocations to approximately the global rate', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 5, leechers: 20, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'bbb', seeders: 10, leechers: 5, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'ccc', seeders: 1, leechers: 50, active: true, eligible: true });

      const allocations = dispatcher.getAllocations();
      const totalAllocated = allocations.reduce((sum, a) => sum + a.bytesPerSecond, 0);
      const expectedTotal = dispatcher.getGlobalRate() * 1024; // KB/s to bytes/s

      expect(totalAllocated).toBeCloseTo(expectedTotal, -1);
    });

    it('should give each torrent at least the floor amount', () => {
      dispatcher.registerTorrent({ infoHash: 'aaa', seeders: 0, leechers: 1000, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'bbb', seeders: 1000, leechers: 1, active: true, eligible: true });
      dispatcher.registerTorrent({ infoHash: 'ccc', seeders: 500, leechers: 2, active: true, eligible: true });

      const allocations = dispatcher.getAllocations();
      const totalBytes = dispatcher.getGlobalRate() * 1024;
      const equalShare = totalBytes / 3;
      const floor = equalShare * 0.1;

      for (const alloc of allocations) {
        expect(alloc.bytesPerSecond).toBeGreaterThanOrEqual(floor * 0.99); // tiny float tolerance
      }
    });
  });
});
