export interface TorrentStatusInput {
  active: boolean;
  seeding: boolean;
  completed: boolean;
  lastFailureTransient: boolean;
  consecutiveFailures: number;
}

export interface TorrentStatusBadge {
  label: string;
  class: string;
}

export function getTorrentStatusBadge(
  torrent: TorrentStatusInput,
  running: boolean | undefined,
  eligible: boolean
): TorrentStatusBadge {
  if (torrent.completed) return { label: 'Completed', class: 'bg-info-soft/50 text-info-accent border border-info-soft-line/50' };
  if (!running) return { label: 'Idle', class: 'bg-surface-input text-content-muted border border-line/50' };
  if (torrent.lastFailureTransient && torrent.active && !torrent.seeding) {
    return { label: 'Waiting', class: 'bg-waiting-soft/50 text-waiting-accent border border-waiting-soft-line/50' };
  }
  if (torrent.consecutiveFailures > 0 && !torrent.seeding) {
    return { label: 'Error', class: 'bg-danger-soft/50 text-danger-accent border border-danger-soft-line/50' };
  }
  if (torrent.seeding && eligible) {
    return { label: 'Seeding', class: 'bg-primary-soft/50 text-primary-accent border border-primary-soft-line/50' };
  }
  if (torrent.seeding) {
    return { label: 'Waiting', class: 'bg-waiting-soft/50 text-waiting-accent border border-waiting-soft-line/50' };
  }
  if (torrent.active) {
    return { label: 'Announcing', class: 'bg-warning-soft/50 text-warning-accent border border-warning-soft-line/50' };
  }
  return { label: 'Queued', class: 'bg-surface-input text-content-muted border border-line/50' };
}
