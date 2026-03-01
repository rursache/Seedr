<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
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

const collapsedGroups = reactive(new Set<string>());

const search = ref('');

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

function toggleCollapse(tracker: string) {
  if (collapsedGroups.has(tracker)) {
    collapsedGroups.delete(tracker);
  } else {
    collapsedGroups.add(tracker);
  }
}

function trackerHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url || 'Unknown'; }
}

/**
 * Derive a human-friendly tracker name from the hostname.
 * e.g. "tracker.scenetime.com" → "Scenetime", "flacsfor.me" → "Flacsfor"
 */
function trackerName(hostname: string): string {
  // Remove common prefixes
  const stripped = hostname.replace(/^(tracker[0-9]*|announce|tr|www)\./, '');
  // Take the domain name part (before TLD)
  const parts = stripped.split('.');
  const name = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
  // Title-case
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const sortedTorrents = computed(() => {
  const q = search.value.toLowerCase().trim();
  const list = q
    ? store.torrents.filter((t) => t.name.toLowerCase().includes(q))
    : [...store.torrents];
  const dir = sortDir.value === 'asc' ? 1 : -1;
  if (sortField.value === 'name') {
    list.sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else {
    list.sort((a, b) => dir * (a.addedIndex - b.addedIndex));
  }
  return list;
});

const groupedTorrents = computed(() => {
  const groups = new Map<string, typeof sortedTorrents.value>();
  for (const t of sortedTorrents.value) {
    const host = trackerHost(t.tracker);
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host)!.push(t);
  }
  return [...groups.entries()]
    .map(([host, torrents]) => ({ host, name: trackerName(host), torrents }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
});

function sortIndicator(field: SortField): string {
  if (sortField.value !== field) return '';
  return sortDir.value === 'asc' ? ' \u25B2' : ' \u25BC';
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
    <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-gray-300 shrink-0">Torrents</h2>
      <div class="flex items-center gap-2">
        <input
          v-if="store.torrents.length >= 5"
          v-model="search"
          type="text"
          placeholder="Search..."
          class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 w-36"
        />
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
    </div>

    <div v-if="store.torrents.length === 0" class="px-4 py-8 text-center text-gray-500 text-sm">
      No torrents loaded. Drop .torrent files anywhere or use Add Torrent.
    </div>

    <div v-else-if="sortedTorrents.length === 0" class="px-4 py-8 text-center text-gray-500 text-sm">
      No torrents matching "{{ search }}"
    </div>

    <div v-else class="divide-y divide-gray-800">
      <template v-for="group in groupedTorrents" :key="group.host">
        <!-- Group header -->
        <div
          class="px-4 py-2 bg-gray-800/40 flex items-center justify-between cursor-pointer select-none hover:bg-gray-800/60 transition-colors"
          @click="toggleCollapse(group.host)"
        >
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <span class="text-gray-600 w-3">{{ collapsedGroups.has(group.host) ? '\u25B8' : '\u25BE' }}</span>
            <span class="font-medium text-gray-300">{{ group.name }}</span>
            <span class="text-gray-600">{{ group.host }}</span>
          </div>
          <span class="text-xs text-gray-600">{{ group.torrents.length }}</span>
        </div>

        <!-- Torrent cards -->
        <template v-if="!collapsedGroups.has(group.host)">
          <div
            v-for="torrent in group.torrents"
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
        </template>
      </template>
    </div>
  </div>
</template>
