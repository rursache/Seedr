<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useSeedrStore } from '../stores/seedr';
import { trackerHost, trackerName } from '../utils/tracker';
import TorrentRow from './TorrentRow.vue';

const store = useSeedrStore();

type SortField = 'name' | 'added';
type SortDir = 'asc' | 'desc';

const savedField = localStorage.getItem('sortField') as SortField | null;
const savedDir = localStorage.getItem('sortDir') as SortDir | null;
const sortField = ref<SortField>(savedField === 'name' || savedField === 'added' ? savedField : 'name');
const sortDir = ref<SortDir>(savedDir === 'asc' || savedDir === 'desc' ? savedDir : 'asc');
if (!savedField) localStorage.setItem('sortField', sortField.value);
if (!savedDir) localStorage.setItem('sortDir', sortDir.value);

const showFileName = computed(() => store.config?.showFileName ?? true);
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

const sortedTorrents = computed(() => {
  const q = search.value.toLowerCase().trim();
  const status = store.statusFilter;
  const list = store.torrents.filter((t) => {
    if (status && !store.matchesStatus(t, status)) return false;
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.fileName.toLowerCase().includes(q);
  });
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
  return sortDir.value === 'asc' ? ' ▲' : ' ▼';
}
</script>

<template>
  <div class="bg-surface-raised rounded-xl border border-line-subtle">
    <div class="px-4 py-3 border-b border-line-subtle flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-content-strong shrink-0">Torrents</h2>
      <div class="flex items-center gap-2">
        <input
          v-if="store.torrents.length >= 5"
          v-model="search"
          type="text"
          placeholder="Search..."
          class="bg-surface-input border border-line rounded-lg px-2.5 py-1 text-xs text-content placeholder-content-faint focus:outline-none focus:border-line-strong w-24 sm:w-36"
        />
        <div v-if="store.torrents.length > 1" class="flex items-center gap-1 text-xs text-content-muted">
          <button
            @click="toggleSort('name')"
            class="px-1.5 py-0.5 rounded transition-colors"
            :class="sortField === 'name' ? 'text-content-strong bg-surface-input' : 'hover:text-content-secondary'"
          >Name{{ sortIndicator('name') }}</button>
          <button
            @click="toggleSort('added')"
            class="px-1.5 py-0.5 rounded transition-colors"
            :class="sortField === 'added' ? 'text-content-strong bg-surface-input' : 'hover:text-content-secondary'"
          >Added{{ sortIndicator('added') }}</button>
        </div>
      </div>
    </div>

    <div v-if="store.torrents.length === 0" class="px-4 py-8 text-center text-content-muted text-sm">
      No torrents loaded. Drop .torrent files anywhere or use Add Torrent.
    </div>

    <div v-else-if="sortedTorrents.length === 0" class="px-4 py-8 text-center text-content-muted text-sm">
      <template v-if="search">No torrents matching "{{ search }}"</template>
      <template v-else>No {{ store.statusFilter }} torrents</template>
      <button
        v-if="store.statusFilter"
        @click="store.toggleStatusFilter(store.statusFilter)"
        class="ml-2 text-xs text-info-accent hover:underline"
      >Clear filter</button>
    </div>

    <div v-else>
      <div v-for="(group, gi) in groupedTorrents" :key="group.host">
        <!-- Group header -->
        <div
          class="px-4 py-2 bg-surface-input/40 flex items-center justify-between cursor-pointer select-none hover:bg-surface-input/60 transition-colors"
          :class="gi > 0 ? 'border-t border-line-subtle' : ''"
          @click="toggleCollapse(group.host)"
        >
          <div class="flex items-center gap-2 text-xs text-content-secondary">
            <span class="text-content-faint text-xs transition-transform duration-200" :class="collapsedGroups.has(group.host) ? '' : 'rotate-90'">&#9654;</span>
            <span class="font-medium text-content-strong">{{ group.name }}</span>
            <span class="text-content-faint">{{ group.host }}</span>
          </div>
          <span class="text-xs text-content-faint">{{ group.torrents.length }}</span>
        </div>

        <!-- Animated torrent cards -->
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-out"
          :class="collapsedGroups.has(group.host) ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'"
        >
          <div class="overflow-hidden min-h-0">
            <TorrentRow
              v-for="torrent in group.torrents"
              :key="torrent.infoHash"
              :torrent="torrent"
              :show-file-name="showFileName"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
