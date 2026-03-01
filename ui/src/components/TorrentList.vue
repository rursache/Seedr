<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSeedrStore } from '../stores/seedr';
import { formatBytes, formatSpeed } from '../utils/format';

const store = useSeedrStore();

type SortField = 'name' | 'added';
type SortDir = 'asc' | 'desc';

const savedField = localStorage.getItem('sortField') as SortField | null;
const savedDir = localStorage.getItem('sortDir') as SortDir | null;
const sortField = ref<SortField>(savedField === 'name' || savedField === 'added' ? savedField : 'name');
const sortDir = ref<SortDir>(savedDir === 'asc' || savedDir === 'desc' ? savedDir : 'asc');
if (!savedField) localStorage.setItem('sortField', sortField.value);
if (!savedDir) localStorage.setItem('sortDir', sortDir.value);

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortDir.value = 'asc';
  }
  localStorage.setItem('sortField', sortField.value);
  localStorage.setItem('sortDir', sortDir.value);
}

const sortedTorrents = computed(() => {
  const list = [...store.torrents];
  const dir = sortDir.value === 'asc' ? 1 : -1;
  if (sortField.value === 'name') {
    list.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else {
    list.sort((a, b) => dir * (a.addedIndex - b.addedIndex));
  }
  return list;
});

function sortIndicator(field: SortField): string {
  if (sortField.value !== field) return '';
  return sortDir.value === 'asc' ? ' ▲' : ' ▼';
}

function torrentStatus(torrent: { active: boolean; seeding: boolean; completed: boolean; consecutiveFailures: number }): { label: string; class: string } {
  const running = store.status?.running;
  if (torrent.completed) return { label: 'Completed', class: 'bg-blue-900/50 text-blue-400 border border-blue-800/50' };
  if (!running) return { label: 'Idle', class: 'bg-gray-800 text-gray-500 border border-gray-700/50' };
  if (torrent.consecutiveFailures > 0 && !torrent.seeding) return { label: 'Error', class: 'bg-red-900/50 text-red-400 border border-red-800/50' };
  if (torrent.seeding) return { label: 'Seeding', class: 'bg-emerald-900/50 text-emerald-400 border border-emerald-800/50' };
  if (torrent.active) return { label: 'Announcing', class: 'bg-amber-900/50 text-amber-400 border border-amber-800/50' };
  return { label: 'Queued', class: 'bg-gray-800 text-gray-500 border border-gray-700/50' };
}

async function remove(infoHash: string) {
  await store.removeTorrent(infoHash);
}

async function announce(infoHash: string) {
  await store.forceAnnounce(infoHash);
}
</script>

<template>
  <div class="bg-gray-900 rounded-lg border border-gray-800">
    <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-300">Torrents</h2>
      <div v-if="store.torrents.length > 1" class="flex items-center gap-1 text-xs text-gray-500">
        <button
          @click="toggleSort('name')"
          class="px-1.5 py-0.5 rounded transition-colors"
          :class="sortField === 'name' ? 'text-gray-300 bg-gray-800' : 'hover:text-gray-400'"
        >Name{{ sortIndicator('name') }}</button>
        <button
          @click="toggleSort('added')"
          class="px-1.5 py-0.5 rounded transition-colors"
          :class="sortField === 'added' ? 'text-gray-300 bg-gray-800' : 'hover:text-gray-400'"
        >Added{{ sortIndicator('added') }}</button>
      </div>
    </div>

    <div v-if="store.torrents.length === 0" class="px-4 py-8 text-center text-gray-500 text-sm">
      No torrents loaded. Drop .torrent files anywhere or use Add Torrent.
    </div>

    <div v-else class="divide-y divide-gray-800">
      <div
        v-for="torrent in sortedTorrents"
        :key="torrent.infoHash"
        class="px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <!-- Row 1: Name + status badge -->
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-medium text-white truncate">{{ torrent.name }}</div>
          <span
            class="text-xs px-2 py-0.5 rounded shrink-0"
            :class="torrentStatus(torrent).class"
          >
            {{ torrentStatus(torrent).label }}
          </span>
        </div>

        <!-- Row 2: Stats -->
        <div class="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
          <span>{{ formatBytes(torrent.size) }}</span>
          <span v-if="torrent.seeding || torrent.completed">
            <span class="text-emerald-400">S:{{ torrent.seeders }}</span>
            <span class="mx-1">/</span>
            <span class="text-amber-400">L:{{ torrent.leechers }}</span>
          </span>
          <span v-else class="text-gray-600">S:-- / L:--</span>
          <span class="text-blue-400">{{ torrent.seeding && !torrent.completed ? formatSpeed(torrent.uploadRate || 0) : '--' }}</span>
          <span title="Local simulated upload">Local: {{ formatBytes(torrent.uploaded) }}</span>
          <span class="text-gray-600" title="Reported to tracker">Reported: {{ formatBytes(torrent.reportedUploaded) }}</span>
        </div>

        <!-- Row 3: Actions -->
        <div class="flex items-center gap-3 mt-2">
          <button
            v-if="torrent.active && store.status?.running"
            @click="announce(torrent.infoHash)"
            class="text-xs text-gray-500 hover:text-blue-400 transition-colors"
          >
            Force Announce
          </button>
          <button
            @click="remove(torrent.infoHash)"
            class="text-xs text-gray-500 hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
