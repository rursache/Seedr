<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import { useSeedrStore, type TorrentInfo } from '../stores/seedr';
import { formatBytes, formatSpeed } from '../utils/format';
import { getTorrentStatusBadge } from '../utils/torrent-status';

const props = defineProps<{ torrent: TorrentInfo; showFileName: boolean }>();

const store = useSeedrStore();

const status = computed(() =>
  getTorrentStatusBadge(props.torrent, store.status?.running, store.isTorrentEligible(props.torrent))
);

// Removal is confirmed by clicking twice, and the row owns that state so a
// pending confirmation can never follow a re-sorted list onto another torrent
const confirmingRemove = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

onUnmounted(() => clearTimeout(confirmTimer));

function remove() {
  if (confirmingRemove.value) {
    clearTimeout(confirmTimer);
    confirmingRemove.value = false;
    store.removeTorrent(props.torrent.infoHash);
    return;
  }
  confirmingRemove.value = true;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => { confirmingRemove.value = false; }, 3000);
}

function announce() {
  store.forceAnnounce(props.torrent.infoHash);
}
</script>

<template>
  <div class="px-4 py-3 hover:bg-gray-800/50 transition-colors border-t border-gray-800">
    <!-- Row 1: Name + status badge -->
    <div class="flex items-center justify-between gap-3">
      <div
        class="text-base font-medium text-white truncate"
        :title="showFileName ? torrent.name : torrent.fileName"
      >{{ showFileName ? torrent.fileName : torrent.name }}</div>
      <span class="text-xs px-2 py-0.5 rounded shrink-0" :class="status.class">
        {{ status.label }}
      </span>
    </div>

    <!-- Row 2: Stats + Actions -->
    <div class="flex flex-wrap items-center justify-between mt-1.5 gap-y-1.5">
      <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-[0.8rem] text-gray-500">
        <span>{{ formatBytes(torrent.size) }}</span>
        <span v-if="torrent.seeding || torrent.completed">
          <span class="text-emerald-400">S:{{ torrent.seeders }}</span>
          <span class="mx-1">/</span>
          <span class="text-amber-400">L:{{ torrent.leechers }}</span>
        </span>
        <span v-else class="text-gray-600">S:-- / L:--</span>
        <span class="text-blue-400">{{ torrent.seeding && !torrent.completed ? formatSpeed(torrent.uploadRate || 0) : '--' }}</span>
        <span title="Local simulated upload">Local: {{ formatBytes(torrent.uploaded) }}</span>
        <span class="hidden sm:inline text-gray-600" title="Reported to tracker">Reported: {{ formatBytes(torrent.reportedUploaded) }}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="torrent.active && store.status?.running"
          @click="announce"
          class="text-xs text-gray-500 hover:text-blue-400 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/20 px-2.5 py-1 rounded-lg transition-all"
        >
          <span class="hidden sm:inline">Force </span>Announce
        </button>
        <button
          @click="remove"
          class="text-xs px-2.5 py-1 rounded-lg transition-all"
          :class="confirmingRemove
            ? 'text-red-400 bg-red-500/20 border border-red-500/40'
            : 'text-gray-500 hover:text-red-400 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20'"
        >
          {{ confirmingRemove ? 'Confirm?' : 'Remove' }}
        </button>
      </div>
    </div>
  </div>
</template>
