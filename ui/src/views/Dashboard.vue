<script setup lang="ts">
import { useSeedrStore } from '../stores/seedr';
import TorrentList from '../components/TorrentList.vue';
import StatusBar from '../components/StatusBar.vue';
import TorrentUpload from '../components/TorrentUpload.vue';
import EventLog from '../components/EventLog.vue';

const store = useSeedrStore();
</script>

<template>
  <div class="space-y-6">
    <!-- Status Cards -->
    <StatusBar />

    <!-- Controls -->
    <div class="flex items-center gap-3">
      <button
        v-if="store.isSeeding"
        @click="store.stopSeeding()"
        :disabled="store.actionPending"
        class="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
      >
        {{ store.actionPending ? 'Stopping...' : 'Stop Seeding' }}
      </button>
      <button
        v-else
        @click="store.startSeeding()"
        :disabled="store.actionPending || store.torrents.length === 0"
        class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
      >
        {{ store.actionPending ? 'Starting...' : 'Start Seeding' }}
      </button>

      <TorrentUpload />
    </div>

    <!-- Torrent List -->
    <TorrentList />

    <!-- Event Log -->
    <EventLog />
  </div>
</template>
