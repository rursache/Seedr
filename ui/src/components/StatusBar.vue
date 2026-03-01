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

const torrentSegments = computed(() => {
  const segments: Array<{ count: number; label: string; color: string }> = [];
  if (store.seedingCount > 0) segments.push({ count: store.seedingCount, label: 'seeding', color: 'text-emerald-600' });
  if (store.errorCount > 0) segments.push({ count: store.errorCount, label: 'error', color: 'text-red-600' });
  if (store.waitingCount > 0) segments.push({ count: store.waitingCount, label: 'waiting', color: 'text-yellow-600' });
  if (store.completedCount > 0) segments.push({ count: store.completedCount, label: 'completed', color: 'text-blue-600' });
  if (segments.length === 0) segments.push({ count: 0, label: 'seeding', color: 'text-gray-600' });
  return segments;
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
  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
    <div class="bg-gray-900 rounded-xl border border-gray-800 p-3 md:p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">Status</div>
      <div class="mt-1 flex items-baseline gap-2">
        <span class="text-base md:text-lg font-semibold" :class="statusClass">{{ statusLabel }}</span>
        <span class="text-gray-700">&middot;</span>
        <span class="text-base md:text-lg font-semibold text-blue-400">{{ speedDisplay }}</span>
      </div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 p-3 md:p-4">
      <div class="text-xs text-gray-500 uppercase tracking-wide">Torrents</div>
      <div class="mt-1 text-base md:text-lg font-semibold text-white flex items-baseline flex-wrap gap-x-1">
        <template v-for="(seg, i) in torrentSegments" :key="seg.label">
          <span v-if="i > 0" class="text-gray-700">,</span>
          <span>{{ seg.count }}</span>
          <span class="text-sm font-normal" :class="seg.color">{{ seg.label }}</span>
        </template>
        <span class="text-gray-700">/</span>
        {{ store.torrents.length }}
        <span class="text-gray-600 text-sm font-normal">loaded</span>
      </div>
    </div>

    <div class="sm:col-span-2 md:col-span-1 bg-gray-900 rounded-xl border border-gray-800 p-3 md:p-4">
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
        <div class="text-base md:text-lg font-semibold text-gray-300 truncate">{{ ipDisplay }}</div>
        <div v-if="store.status?.running" class="text-base md:text-lg font-semibold text-gray-300 shrink-0">{{ store.status.port }}</div>
        <div v-else class="text-base md:text-lg font-semibold text-gray-500 shrink-0">—</div>
      </div>
    </div>
  </div>
</template>
