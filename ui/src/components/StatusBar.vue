<script setup lang="ts">
import { useSeedrStore } from '../stores/seedr';
import { formatSpeed } from '../utils/format';
import { computed } from 'vue';

const store = useSeedrStore();

const engineState = computed(() => {
  if (!store.status?.running) return 'idle';
  if (store.seedingCount > 0) return 'seeding';
  if (store.activeCount > 0) return 'announcing';
  return 'idle';
});

const statusLabel = computed(() => {
  switch (engineState.value) {
    case 'seeding': return 'Seeding';
    case 'announcing': return 'Announcing';
    default: return 'Idle';
  }
});

const statusClass = computed(() => {
  switch (engineState.value) {
    case 'seeding': return 'text-emerald-400';
    case 'announcing': return 'text-amber-400';
    default: return 'text-gray-500';
  }
});

const speedDisplay = computed(() => {
  if (!store.isSeeding) return '—';
  return formatSpeed(store.status?.actualUploadRate ?? 0);
});

const ipDisplay = computed(() => {
  if (!store.status?.running) return '—';
  return store.status.externalIp || 'Resolving...';
});
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">Status</div>
      <div
        class="mt-1 text-lg font-semibold"
        :class="statusClass"
      >
        {{ statusLabel }}
      </div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">Upload Speed</div>
      <div class="mt-1 text-lg font-semibold text-blue-400">{{ speedDisplay }}</div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">Torrents</div>
      <div class="mt-1 text-lg font-semibold text-white">
        {{ store.seedingCount }} <span class="text-gray-600 text-sm font-normal">seeding</span>
        / {{ store.torrents.length }} <span class="text-gray-600 text-sm font-normal">loaded</span>
      </div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs text-gray-500 uppercase tracking-wide">External IP</div>
        <div class="text-xs text-gray-500 flex items-center gap-2">
          <template v-if="store.status?.running">
            <span v-if="store.portCheck.checking" class="text-gray-400">Port: Checking...</span>
            <template v-else-if="store.portCheck.result">
              <span>Port:</span>
              <span :class="store.portCheck.result.reachable ? 'text-emerald-400' : 'text-red-400'">
                {{ store.portCheck.result.reachable ? 'Open' : 'Closed' }}
              </span>
              <button
                @click="store.checkPort()"
                class="text-gray-500 hover:text-gray-300 transition-colors"
                title="Re-check port"
              >
                &#x21bb;
              </button>
            </template>
            <template v-else-if="store.portCheck.error">
              <span>Port:</span>
              <span class="text-red-400">{{ store.portCheck.error }}</span>
              <button
                @click="store.checkPort()"
                class="text-gray-500 hover:text-gray-300 transition-colors"
                title="Retry port check"
              >
                &#x21bb;
              </button>
            </template>
            <template v-else>
              <span>Port:</span>
              <button
                @click="store.checkPort()"
                class="text-gray-500 hover:text-gray-300 transition-colors"
                title="Check port"
              >
                &#x21bb;
              </button>
            </template>
          </template>
          <template v-else>
            <span>Port: —</span>
          </template>
        </div>
      </div>
      <div class="mt-1 flex items-baseline justify-between">
        <div class="text-lg font-semibold text-gray-300 truncate">{{ ipDisplay }}</div>
        <div v-if="store.status?.running" class="text-lg font-semibold text-gray-300 shrink-0">{{ store.status.port }}</div>
        <div v-else class="text-lg font-semibold text-gray-500 shrink-0">—</div>
      </div>
    </div>
  </div>
</template>
