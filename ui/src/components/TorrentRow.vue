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
  <div class="px-4 py-3 hover:bg-surface-input/50 transition-colors border-t border-line-subtle">
    <!-- Row 1: Name + status badge -->
    <div class="flex items-center justify-between gap-3">
      <div
        class="text-base font-medium text-content truncate"
        :title="showFileName ? torrent.name : torrent.fileName"
      >{{ showFileName ? torrent.fileName : torrent.name }}</div>
      <span class="text-xs px-2 py-0.5 rounded shrink-0" :class="status.class">
        {{ status.label }}
      </span>
    </div>

    <!-- Row 2: Stats + Actions -->
    <div class="flex flex-wrap items-center justify-between mt-1.5 gap-y-1.5">
      <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-[0.8rem] text-content-muted">
        <span>{{ formatBytes(torrent.size) }}</span>
        <span v-if="torrent.seeding || torrent.completed">
          <span class="text-primary-accent">S:{{ torrent.seeders }}</span>
          <span class="mx-1">/</span>
          <span class="text-warning-accent">L:{{ torrent.leechers }}</span>
        </span>
        <span v-else class="text-content-faint">S:-- / L:--</span>
        <span class="text-info-accent">{{ torrent.seeding && !torrent.completed ? formatSpeed(torrent.uploadRate || 0) : '--' }}</span>
        <span title="Local simulated upload">Local: {{ formatBytes(torrent.uploaded) }}</span>
        <span class="hidden sm:inline text-content-faint" title="Reported to tracker">Reported: {{ formatBytes(torrent.reportedUploaded) }}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          v-if="torrent.active && store.status?.running"
          @click="announce"
          class="text-xs text-content-muted hover:text-info-accent bg-info-strong/5 hover:bg-info-strong/10 border border-info-strong/10 hover:border-info-strong/20 px-2.5 py-1 rounded-lg transition-all"
        >
          <span class="hidden sm:inline">Force </span>Announce
        </button>
        <button
          @click="remove"
          class="text-xs px-2.5 py-1 rounded-lg transition-all"
          :class="confirmingRemove
            ? 'text-danger-accent bg-danger-strong/20 border border-danger-strong/40'
            : 'text-content-muted hover:text-danger-accent bg-danger-strong/5 hover:bg-danger-strong/10 border border-danger-strong/10 hover:border-danger-strong/20'"
        >
          {{ confirmingRemove ? 'Delete file?' : 'Remove' }}
        </button>
      </div>
    </div>
  </div>
</template>
