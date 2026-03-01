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
});
