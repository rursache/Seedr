<script setup lang="ts">
import { useSeedrStore, type TorrentStatusFilter } from '../stores/seedr';
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
    case 'seeding': return 'text-primary-accent';
    case 'announcing': return 'text-warning-accent';
    default: return 'text-content-muted';
  }
});

type Segment = { count: number; label: string; color: string; status: TorrentStatusFilter };

const torrentSegments = computed(() => {
  const segments: Segment[] = [];
  if (store.seedingCount > 0) segments.push({ count: store.seedingCount, label: 'seeding', color: 'text-primary', status: 'seeding' });
  if (store.errorCount > 0) segments.push({ count: store.errorCount, label: 'error', color: 'text-danger', status: 'error' });
  if (store.waitingCount > 0) segments.push({ count: store.waitingCount, label: 'waiting', color: 'text-waiting', status: 'waiting' });
  if (store.completedCount > 0) segments.push({ count: store.completedCount, label: 'completed', color: 'text-info', status: 'completed' });
  // Nothing to filter by when there is nothing to show
  if (segments.length === 0) segments.push({ count: 0, label: 'seeding', color: 'text-content-faint', status: null });
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
  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[3fr_4fr_3fr] gap-3">
    <div class="bg-surface-raised rounded-xl border border-line-subtle p-3 md:p-4">
      <div class="text-xs text-content-muted uppercase tracking-wide">Status</div>
      <div class="mt-1 flex items-baseline gap-2">
        <span class="text-base md:text-lg font-semibold" :class="statusClass">{{ statusLabel }}</span>
        <span class="text-content-ghost">&middot;</span>
        <span class="text-base md:text-lg font-semibold text-info-accent">{{ speedDisplay }}</span>
      </div>
    </div>

    <div class="bg-surface-raised rounded-xl border border-line-subtle p-3 md:p-4">
      <div class="text-xs text-content-muted uppercase tracking-wide">Torrents</div>
      <div class="mt-1 text-base md:text-lg font-semibold text-content flex items-baseline flex-wrap gap-x-1">
        <template v-for="(seg, i) in torrentSegments" :key="seg.label">
          <span v-if="i > 0" class="text-content-ghost">,</span>
          <component
            :is="seg.status ? 'button' : 'span'"
            :class="[
              'inline-flex items-baseline gap-1 rounded transition-colors',
              seg.status ? 'cursor-pointer hover:bg-surface-input/60' : '',
            ]"
            :title="seg.status ? `Show only ${seg.label} torrents` : undefined"
            @click="seg.status && store.toggleStatusFilter(seg.status)"
          >
            <span>{{ seg.count }}</span>
            <span
              class="text-sm"
              :class="[seg.color, store.statusFilter === seg.status ? 'font-semibold' : 'font-normal']"
            >{{ seg.label }}</span>
          </component>
        </template>
        <span class="text-content-ghost">/</span>
        {{ store.torrents.length }}
        <span class="text-content-faint text-sm font-normal">loaded</span>
      </div>
    </div>

    <div class="sm:col-span-2 md:col-span-1 bg-surface-raised rounded-xl border border-line-subtle p-3 md:p-4">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs text-content-muted uppercase tracking-wide">External IP</div>
        <div class="text-xs text-content-muted flex items-center gap-2">
          <template v-if="store.status?.running">
            <span v-if="store.portCheck.checking" class="text-content-secondary">Port: Checking...</span>
            <template v-else-if="store.portCheck.result">
              <span>Port:</span>
              <span :class="store.portCheck.result.reachable ? 'text-primary-accent' : 'text-danger-accent'">
                {{ store.portCheck.result.reachable ? 'Open' : 'Closed' }}
              </span>
              <button
                @click="store.checkPort()"
                class="text-content-muted hover:text-content-strong transition-colors"
                title="Re-check port"
              >
                &#x21bb;
              </button>
            </template>
            <template v-else-if="store.portCheck.error">
              <span>Port:</span>
              <span class="text-danger-accent">{{ store.portCheck.error }}</span>
              <button
                @click="store.checkPort()"
                class="text-content-muted hover:text-content-strong transition-colors"
                title="Retry port check"
              >
                &#x21bb;
              </button>
            </template>
            <template v-else>
              <span>Port:</span>
              <button
                @click="store.checkPort()"
                class="text-content-muted hover:text-content-strong transition-colors"
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
        <div class="text-base md:text-lg font-semibold text-content-strong truncate">{{ ipDisplay }}</div>
        <div v-if="store.status?.running" class="text-base md:text-lg font-semibold text-content-strong shrink-0">{{ store.status.port }}</div>
        <div v-else class="text-base md:text-lg font-semibold text-content-muted shrink-0">—</div>
      </div>
    </div>
  </div>
</template>
