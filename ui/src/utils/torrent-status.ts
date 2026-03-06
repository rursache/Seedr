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
  if (torrent.completed) return { label: 'Completed', class: 'bg-blue-900/50 text-blue-400 border border-blue-800/50' };
  if (!running) return { label: 'Idle', class: 'bg-gray-800 text-gray-500 border border-gray-700/50' };
  if (torrent.lastFailureTransient && torrent.active && !torrent.seeding) {
    return { label: 'Waiting', class: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800/50' };
  }
  if (torrent.consecutiveFailures > 0 && !torrent.seeding) {
    return { label: 'Error', class: 'bg-red-900/50 text-red-400 border border-red-800/50' };
  }
  if (torrent.seeding && eligible) {
    return { label: 'Seeding', class: 'bg-emerald-900/50 text-emerald-400 border border-emerald-800/50' };
  }
  if (torrent.seeding) {
    return { label: 'Waiting', class: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800/50' };
  }
  if (torrent.active) {
    return { label: 'Announcing', class: 'bg-amber-900/50 text-amber-400 border border-amber-800/50' };
  }
  return { label: 'Queued', class: 'bg-gray-800 text-gray-500 border border-gray-700/50' };
}
