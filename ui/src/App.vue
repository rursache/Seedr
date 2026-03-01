<script setup lang="ts">
import { useSeedrStore } from './stores/seedr';
import { onMounted, ref } from 'vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';

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
    <nav class="bg-gray-900 border-b border-gray-800">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <div class="flex items-center gap-6">
            <span class="text-lg font-bold text-emerald-400">Seedr</span>
          </div>

          <div class="flex items-center gap-4 text-sm">
            <button
              @click="showSettings = true"
              class="text-gray-400 hover:text-white transition-colors"
            >
              Settings
            </button>
            <span
              class="flex items-center gap-1.5"
              :class="store.connected ? 'text-emerald-400' : 'text-red-400'"
            >
              <span class="w-2 h-2 rounded-full" :class="store.connected ? 'bg-emerald-400' : 'bg-red-400'"></span>
              {{ store.connected ? 'Connected' : 'Disconnected' }}
            </span>
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
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60" @click="showSettings = false"></div>
        <!-- Modal -->
        <div class="relative bg-gray-950 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
          <div class="sticky top-0 bg-gray-950 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
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
