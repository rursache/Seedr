<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSeedrStore, type SeedrEvent } from '../stores/seedr';

const store = useSeedrStore();

type FilterMode = 'all' | 'problems' | 'activity';
const filter = ref<FilterMode>('all');

const filterOptions = [
  { value: 'all', label: 'All events' },
  { value: 'problems', label: 'Problems' },
  { value: 'activity', label: 'Activity' },
];

type Severity = 'error' | 'warn' | 'success' | 'info';

/** One place deciding how an event type reads, rather than scattered guesses. */
const META: Record<string, { label: string; severity: Severity }> = {
  'announce:failure': { label: 'Announce failed', severity: 'error' },
  'announce:success': { label: 'Announced', severity: 'success' },
  'torrent:added': { label: 'Torrent added', severity: 'info' },
  'torrent:removed': { label: 'Torrent removed', severity: 'info' },
  'torrent:completed': { label: 'Ratio target reached', severity: 'success' },
  started: { label: 'Seeding started', severity: 'success' },
  stopped: { label: 'Seeding stopped', severity: 'warn' },
};

function meta(type: string) {
  return META[type] ?? { label: type, severity: 'info' as Severity };
}

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string }> = {
  error: { dot: 'bg-danger-accent', text: 'text-danger-accent' },
  warn: { dot: 'bg-warning-accent', text: 'text-warning-accent' },
  success: { dot: 'bg-primary-accent', text: 'text-primary-accent' },
  info: { dot: 'bg-info-accent', text: 'text-info-accent' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${time}`;
}

const problems = new Set<Severity>(['error', 'warn']);

const filteredEvents = computed(() => {
  if (filter.value === 'all') return store.events;
  const wantProblem = filter.value === 'problems';
  return store.events.filter((e) => problems.has(meta(e.type).severity) === wantProblem);
});

/** The torrent an event concerns, falling back to a short hash if unnamed. */
function subject(event: SeedrEvent): string {
  const d = event.data as Record<string, unknown> | undefined;
  if (!d) return '';
  if (typeof d.name === 'string' && d.name) return d.name;
  if (typeof d.infoHash === 'string' && d.infoHash) return d.infoHash.slice(0, 8);
  return '';
}

/** The human-facing detail: an error, peer counts, or nothing. */
function detail(event: SeedrEvent): string {
  const d = event.data as Record<string, unknown> | undefined;
  if (!d) return '';
  if (typeof d.error === 'string' && d.error) return d.error;
  if (typeof d.seeders === 'number') return `${d.seeders} seeders, ${d.leechers} leechers`;
  return '';
}

function tracker(event: SeedrEvent): string {
  const d = event.data as Record<string, unknown> | undefined;
  return typeof d?.tracker === 'string' ? d.tracker : '';
}

const clearing = ref(false);

async function clearAll() {
  clearing.value = true;
  try {
    await store.clearEvents();
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col">
    <!-- Toolbar -->
    <div class="px-4 py-3 flex items-center justify-between gap-3 border-b border-line-subtle">
      <div class="flex items-center gap-2 min-w-0">
        <div class="relative shrink-0">
          <select
            v-model="filter"
            class="appearance-none bg-surface-input border border-line rounded-lg pl-3 pr-8 py-1.5 text-xs text-content-strong focus:outline-none focus:border-line-strong"
          >
            <option v-for="o in filterOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <svg
            class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-content-secondary"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        <span class="text-xs text-content-faint shrink-0">
          {{ filteredEvents.length }}{{ filter === 'all' ? '' : ` of ${store.events.length}` }}
        </span>
      </div>

      <button
        :disabled="store.events.length === 0 || clearing"
        @click="clearAll"
        class="shrink-0 text-xs px-2.5 py-1.5 rounded-lg transition-colors text-content-secondary hover:text-danger-accent bg-danger-strong/5 hover:bg-danger-strong/10 border border-danger-strong/10 hover:border-danger-strong/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-content-secondary"
      >
        Clear all
      </button>
    </div>

    <!-- Rows -->
    <div class="max-h-[60vh] overflow-y-auto">
      <div
        v-if="filteredEvents.length === 0"
        class="px-4 py-12 text-center text-sm text-content-faint"
      >
        <template v-if="store.events.length === 0">Nothing has happened yet</template>
        <template v-else>No {{ filter === 'problems' ? 'problems' : 'activity' }} to show</template>
      </div>

      <div
        v-for="event in filteredEvents"
        :key="event.id"
        class="group px-4 py-2.5 flex items-start gap-3 border-b border-line-subtle/50 last:border-0 hover:bg-surface-input/40 transition-colors"
      >
        <span
          class="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
          :class="SEVERITY_STYLE[meta(event.type).severity].dot"
        />

        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span class="text-sm font-medium" :class="SEVERITY_STYLE[meta(event.type).severity].text">
              {{ meta(event.type).label }}
            </span>
            <span v-if="subject(event)" class="text-sm text-content-strong truncate max-w-full">
              {{ subject(event) }}
            </span>
          </div>

          <p v-if="detail(event)" class="mt-0.5 text-xs text-content-secondary break-words">
            {{ detail(event) }}
          </p>
          <p
            v-if="tracker(event)"
            class="mt-0.5 text-xs text-content-faint font-mono break-all"
          >{{ tracker(event) }}</p>
        </div>

        <span class="text-xs text-content-faint font-mono shrink-0 mt-0.5 tabular-nums">
          {{ formatTime(event.time) }}
        </span>

        <button
          @click="store.dismissEvent(event.id)"
          class="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded text-content-faint opacity-40 group-hover:opacity-100 focus:opacity-100 hover:text-danger-accent hover:bg-danger-strong/10 transition-all"
          title="Dismiss"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
