<script setup lang="ts">
import { useSeedrStore } from './stores/seedr';
import { onMounted, ref } from 'vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';
import TorrentUpload from './components/TorrentUpload.vue';

const store = useSeedrStore();
const showSettings = ref(false);

onMounted(() => {
  store.fetchConfig();
  store.fetchClients();
  store.fetchStatus();
  store.fetchTorrents();
});
</script>

<template>
  <div class="min-h-screen bg-gray-950">
    <!-- Navigation -->
    <nav class="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <!-- Left: Logo + connection status -->
          <div class="flex items-center gap-4">
            <span class="text-lg font-bold text-emerald-400 tracking-tight">Seedr</span>
            <span
              class="flex items-center gap-1.5 text-xs"
              :class="store.connected ? 'text-emerald-400/70' : 'text-red-400/70'"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="store.connected ? 'bg-emerald-400' : 'bg-red-400'"></span>
              {{ store.connected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>

          <!-- Right: Actions -->
          <div class="flex items-center gap-2">
            <!-- Start / Stop Seeding -->
            <button
              v-if="store.isSeeding"
              @click="store.stopSeeding()"
              :disabled="store.actionPending"
              class="px-3 py-1.5 bg-red-600/90 hover:bg-red-500 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors"
            >
              {{ store.actionPending ? 'Stopping...' : 'Stop Seeding' }}
            </button>
            <button
              v-else
              @click="store.startSeeding()"
              :disabled="store.actionPending || store.torrents.length === 0"
              class="px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors"
            >
              {{ store.actionPending ? 'Starting...' : 'Start Seeding' }}
            </button>

            <!-- Upload Torrent -->
            <TorrentUpload />

            <!-- Divider -->
            <div class="w-px h-5 bg-gray-700/50"></div>

            <!-- Settings -->
            <button
              @click="showSettings = true"
              class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-md text-xs font-medium transition-colors"
            >
              Settings
            </button>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <Dashboard />
    </main>

    <!-- Settings Modal -->
    <Teleport to="body">
      <div
        v-if="showSettings"
        class="fixed inset-0 z-50 flex items-start justify-center pt-16"
      >
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showSettings = false"></div>
        <div class="relative bg-gray-950 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
          <div class="sticky top-0 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-6 py-4 flex items-center justify-between">
            <h2 class="text-lg font-bold text-white">Settings</h2>
            <button
              @click="showSettings = false"
              class="text-gray-500 hover:text-white transition-colors text-xl leading-none"
            >
              &times;
            </button>
          </div>
          <div class="p-6">
            <Settings />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
