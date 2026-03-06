import { describe, expect, it } from 'vitest';
import { getTorrentStatusBadge } from '../ui/src/utils/torrent-status';

function makeTorrent(overrides: Partial<Parameters<typeof getTorrentStatusBadge>[0]> = {}) {
  return {
    active: false,
    seeding: false,
    completed: false,
    lastFailureTransient: false,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('getTorrentStatusBadge', () => {
  it('shows Waiting for transient failures on the short retry path', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: false, lastFailureTransient: true, consecutiveFailures: 1 }),
      true,
      false
    );

    expect(badge.label).toBe('Waiting');
  });

  it('shows Error for non-transient failures', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: false, lastFailureTransient: false, consecutiveFailures: 1 }),
      true,
      false
    );

    expect(badge.label).toBe('Error');
  });

  it('shows Seeding for eligible active torrents', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: true }),
      true,
      true
    );

    expect(badge.label).toBe('Seeding');
  });

  it('shows Waiting for ineligible seeding torrents', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: true }),
      true,
      false
    );

    expect(badge.label).toBe('Waiting');
  });

  it('shows Announcing for active torrents before first successful announce', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: false }),
      true,
      false
    );

    expect(badge.label).toBe('Announcing');
  });

  it('shows Idle when the engine is not running', () => {
    const badge = getTorrentStatusBadge(
      makeTorrent({ active: true, seeding: true, completed: false }),
      false,
      true
    );

    expect(badge.label).toBe('Idle');
  });
});
