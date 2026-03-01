<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSeedrStore, type SeedrEvent } from '../stores/seedr';

const store = useSeedrStore();
const expanded = ref(false);

type FilterMode = 'all' | 'warnings' | 'success';
const filter = ref<FilterMode>('warnings');

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function eventColor(type: string): string {
  if (type === 'started') return 'text-emerald-400';
  if (type === 'stopped') return 'text-amber-400';
  if (type.includes('success')) return 'text-emerald-400';
  if (type.includes('failure')) return 'text-red-400';
  if (type.includes('added')) return 'text-blue-400';
  if (type.includes('removed')) return 'text-amber-400';
  return 'text-gray-400';
}

function isWarningOrError(event: SeedrEvent): boolean {
  return event.type.includes('failure') || event.type === 'stopped' || event.type.includes('removed');
}

function isSuccess(event: SeedrEvent): boolean {
  return event.type.includes('success') || event.type === 'started' || event.type.includes('added');
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
  <div class="bg-gray-900 rounded-lg border border-gray-800">
    <button
      @click="expanded = !expanded"
      class="w-full px-4 py-3 flex items-center justify-between text-left"
      :class="expanded ? 'border-b border-gray-800' : ''"
    >
      <div class="flex items-center gap-3">
        <span class="text-gray-500 text-xs transition-transform" :class="expanded ? 'rotate-90' : ''">&#9654;</span>
        <h2 class="text-sm font-semibold text-gray-300">Event Log</h2>
        <span class="text-xs text-gray-600">({{ store.events.length }})</span>
      </div>

      <!-- Filter dropdown (stop click from toggling collapse) -->
      <select
        v-if="expanded"
        v-model="filter"
        @click.stop
        class="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded px-2 py-1 focus:outline-none focus:border-gray-600"
      >
        <option value="warnings">Warnings & Errors</option>
        <option value="success">Success</option>
        <option value="all">All</option>
      </select>
    </button>

    <div v-if="expanded" class="max-h-48 overflow-y-auto">
      <div v-if="filteredEvents.length === 0" class="px-4 py-4 text-center text-gray-600 text-xs">
        No matching events
      </div>
      <div
        v-for="event in filteredEvents"
        :key="event.id"
        class="px-4 py-1.5 text-xs font-mono flex items-center gap-3 hover:bg-gray-800/50"
      >
        <span class="text-gray-600 shrink-0">{{ formatTime(event.time) }}</span>
        <span :class="eventColor(event.type)" class="shrink-0">{{ event.type }}</span>
        <span class="text-gray-500 truncate">{{ eventSummary(event) }}</span>
      </div>
    </div>
  </div>
</template>
