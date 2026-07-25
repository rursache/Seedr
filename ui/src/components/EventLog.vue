<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSeedrStore, type SeedrEvent } from '../stores/seedr';

const store = useSeedrStore();

type FilterMode = 'all' | 'warnings' | 'success';
const filter = ref<FilterMode>('warnings');

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function eventColor(type: string): string {
  if (type === 'started') return 'text-primary-accent';
  if (type === 'stopped') return 'text-warning-accent';
  if (type.includes('completed')) return 'text-info-accent';
  if (type.includes('success')) return 'text-primary-accent';
  if (type.includes('failure')) return 'text-danger-accent';
  if (type.includes('added')) return 'text-info-accent';
  if (type.includes('removed')) return 'text-info-accent';
  return 'text-content-secondary';
}

function isWarningOrError(event: SeedrEvent): boolean {
  return event.type.includes('failure') || event.type === 'stopped';
}

function isSuccess(event: SeedrEvent): boolean {
  return event.type.includes('success') || event.type === 'started' || event.type.includes('added') || event.type.includes('removed') || event.type.includes('completed');
}

const filteredEvents = computed(() => {
  if (filter.value === 'all') return store.events;
  if (filter.value === 'warnings') return store.events.filter(isWarningOrError);
  if (filter.value === 'success') return store.events.filter(isSuccess);
  return store.events;
});

function eventSummary(event: { type: string; data: any }): string {
  const d = event.data;
  if (!d) return '';
  if (event.type === 'started') return 'Engine started';
  if (event.type === 'stopped') return 'Engine stopped';
  const parts: string[] = [];
  if (d.name) parts.push(d.name);
  else if (d.infoHash) parts.push(d.infoHash.slice(0, 8));
  if (d.seeders !== undefined) parts.push(`S:${d.seeders} L:${d.leechers}`);
  if (d.tracker) parts.push(d.tracker);
  if (d.error) parts.push(d.error);
  return parts.join(' — ');
}
</script>

<template>
  <div>
    <div class="px-4 py-2 flex items-center justify-end border-b border-line-subtle/50">
      <select
        v-model="filter"
        class="bg-surface-input border border-line text-content-secondary text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-line-strong"
      >
        <option value="warnings">Warnings & Errors</option>
        <option value="success">Success</option>
        <option value="all">All</option>
      </select>
    </div>
    <div class="max-h-[60vh] overflow-y-auto">
      <div v-if="filteredEvents.length === 0" class="px-4 py-8 text-center text-content-faint text-xs">
        No matching events
      </div>
      <div
        v-for="event in filteredEvents"
        :key="event.id"
        class="px-4 py-2 text-xs font-mono flex items-start gap-3 hover:bg-surface-input/50"
      >
        <span class="text-content-faint shrink-0 pt-0.5">{{ formatTime(event.time) }}</span>
        <span :class="eventColor(event.type)" class="shrink-0 pt-0.5">{{ event.type }}</span>
        <span class="text-content-muted min-w-0 whitespace-normal break-all leading-5">{{ eventSummary(event) }}</span>
      </div>
    </div>
  </div>
</template>
