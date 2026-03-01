<script setup lang="ts">
import { useSeedrStore } from '../stores/seedr';
import { formatBytes, formatSpeed } from '../utils/format';

const store = useSeedrStore();

function torrentStatus(torrent: { active: boolean; seeding: boolean }): { label: string; class: string } {
  if (torrent.seeding) return { label: 'Seeding', class: 'bg-emerald-900/50 text-emerald-400' };
  if (torrent.active) return { label: 'Announcing', class: 'bg-amber-900/50 text-amber-400' };
  return { label: 'Queued', class: 'bg-gray-800 text-gray-500' };
}

async function remove(infoHash: string) {
  await store.removeTorrent(infoHash);
}
</script>

<template>
  <div class="bg-gray-900 rounded-lg border border-gray-800">
    <div class="px-4 py-3 border-b border-gray-800">
      <h2 class="text-sm font-semibold text-gray-300">Torrents</h2>
    </div>

    <div v-if="store.torrents.length === 0" class="px-4 py-8 text-center text-gray-500 text-sm">
      No torrents loaded. Drop .torrent files in the torrents directory or upload above.
    </div>

    <div v-else class="divide-y divide-gray-800">
      <div
        v-for="torrent in store.torrents"
        :key="torrent.infoHash"
        class="px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-white truncate">{{ torrent.name }}</div>
            <div class="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span>{{ formatBytes(torrent.size) }}</span>
              <span v-if="torrent.seeding">
                <span class="text-emerald-400">S:{{ torrent.seeders }}</span>
                <span class="mx-1">/</span>
                <span class="text-amber-400">L:{{ torrent.leechers }}</span>
              </span>
              <span v-else class="text-gray-600">S:— / L:—</span>
              <span class="text-blue-400">{{ torrent.seeding ? formatSpeed(torrent.uploadRate || 0) : '—' }}</span>
              <span>Up: {{ formatBytes(torrent.uploaded) }}</span>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <span
              class="text-xs px-2 py-0.5 rounded"
              :class="torrentStatus(torrent).class"
            >
              {{ torrentStatus(torrent).label }}
            </span>
            <button
              @click="remove(torrent.infoHash)"
              class="text-gray-500 hover:text-red-400 transition-colors text-xs"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
