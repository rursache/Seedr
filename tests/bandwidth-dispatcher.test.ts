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
});
