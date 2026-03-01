<script setup lang="ts">
import { useSeedrStore } from '../stores/seedr';

const store = useSeedrStore();

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

function eventSummary(event: { type: string; data: any }): string {
  const d = event.data;
  if (!d) return '';
  const parts: string[] = [];
  if (d.infoHash) parts.push(d.infoHash.slice(0, 8));
  if (d.name) parts.push(d.name);
  if (d.seeders !== undefined) parts.push(`S:${d.seeders} L:${d.leechers}`);
  if (d.uploaded !== undefined) parts.push(`Up:${d.uploaded}`);
  if (d.tracker) parts.push(d.tracker);
  if (d.error) parts.push(d.error);
  if (event.type === 'started') return 'Engine started';
  if (event.type === 'stopped') return 'Engine stopped';
  return parts.join(' ');
}
</script>

<template>
  <div class="bg-gray-900 rounded-lg border border-gray-800">
    <div class="px-4 py-3 border-b border-gray-800">
      <h2 class="text-sm font-semibold text-gray-300">Event Log</h2>
    </div>

    <div class="max-h-48 overflow-y-auto">
      <div v-if="store.events.length === 0" class="px-4 py-4 text-center text-gray-500 text-xs">
        No events yet
      </div>
      <div
        v-for="event in store.events"
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
