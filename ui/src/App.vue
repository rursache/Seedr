<script setup lang="ts">
import { useSeedrStore } from './stores/seedr';
import { onMounted, ref, computed } from 'vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';
import TorrentUpload from './components/TorrentUpload.vue';
import EventLog from './components/EventLog.vue';
import ModalDialog from './components/ModalDialog.vue';
import DropZone from './components/DropZone.vue';
import { useTheme } from './composables/useTheme';

const store = useSeedrStore();

useTheme();
const showSettings = ref(false);
const showEventLog = ref(false);
const lastSeenEventId = ref(0);

function openEventLog() {
  showEventLog.value = true;
  if (store.events.length > 0) lastSeenEventId.value = store.events[0].id;
}

const hasErrors = computed(() => store.events.some(e => e.id > lastSeenEventId.value && (e.type.includes('failure') || e.type === 'stopped')));

// Settings modal save via exposed ref
const settingsRef = ref<InstanceType<typeof Settings> | null>(null);
const settingsSaving = computed(() => settingsRef.value?.saving ?? false);
const settingsFormReady = computed(() => settingsRef.value?.formReady ?? false);
const settingsSaveMessage = computed(() => settingsRef.value?.saveMessage ?? null);
function saveSettings() { settingsRef.value?.save(); }

onMounted(() => {
  store.fetchConfig();
  store.fetchClients();
  store.fetchStatus();
  store.fetchTorrents();
  store.fetchVersion();
  store.fetchEvents();
});
</script>

<template>
  <div class="min-h-screen bg-surface">
    <!-- Navigation -->
    <nav class="bg-surface-raised/80 backdrop-blur-sm border-b border-line-subtle sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <!-- Left: Logo + connection status -->
          <div class="flex items-center gap-2 md:gap-4">
            <img src="/favicon.svg" alt="Seedr" class="h-6 w-6" />
            <span class="text-lg font-bold text-content tracking-tight">Seedr</span>
            <span
              class="flex items-center gap-1.5 text-xs"
              :class="store.connected ? 'text-primary-accent/70' : 'text-danger-accent/70'"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="store.connected ? 'bg-primary-accent' : 'bg-danger-accent'"></span>
              <span class="hidden sm:inline">{{ store.connected ? 'Connected' : 'Disconnected' }}</span>
            </span>
          </div>

          <!-- Right: Actions -->
          <div class="flex items-center gap-1.5 md:gap-2">
            <!-- Start / Stop Seeding -->
            <button
              v-if="store.isSeeding"
              @click="store.stopSeeding()"
              :disabled="store.actionPending"
              class="px-2 md:px-3 py-1.5 bg-danger-strong/50 hover:bg-danger-strong/70 disabled:opacity-50 text-on-accent rounded-lg text-xs font-medium transition-colors"
            >
              <span class="hidden md:inline">{{ store.actionPending ? 'Stopping...' : 'Stop Seeding' }}</span>
              <span class="md:hidden">{{ store.actionPending ? '...' : 'Stop' }}</span>
            </button>
            <button
              v-else
              @click="store.startSeeding()"
              :disabled="store.actionPending || store.torrents.length === 0"
              class="px-2 md:px-3 py-1.5 bg-primary/90 hover:bg-primary-strong disabled:opacity-50 text-on-accent rounded-lg text-xs font-medium transition-colors"
            >
              <span class="hidden md:inline">{{ store.actionPending ? 'Starting...' : 'Start Seeding' }}</span>
              <span class="md:hidden">{{ store.actionPending ? '...' : 'Start' }}</span>
            </button>

            <!-- Upload Torrent -->
            <TorrentUpload />

            <!-- Divider -->
            <div class="w-px h-5 bg-surface-hover/50"></div>

            <!-- Event Log -->
            <button
              @click="openEventLog()"
              class="relative w-[30px] h-[30px] flex items-center justify-center bg-surface-input hover:bg-surface-hover border border-line text-content-secondary hover:text-content rounded-lg transition-colors"
              title="Event Log"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2.5" y="4" width="19" height="16" rx="2" />
                <path d="m6.5 9 2.5 2.5L6.5 14" />
                <path d="M12 14.5h5.5" />
              </svg>
              <span
                v-if="hasErrors"
                class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-danger-strong rounded-full"
              ></span>
            </button>

            <!-- Settings -->
            <button
              @click="showSettings = true"
              class="hidden md:block px-3 py-1.5 bg-surface-input hover:bg-surface-hover border border-line text-content-strong hover:text-content rounded-lg text-xs font-medium transition-colors"
            >
              Settings
            </button>
            <button
              @click="showSettings = true"
              class="md:hidden w-[30px] h-[30px] flex items-center justify-center bg-surface-input hover:bg-surface-hover border border-line text-content-secondary hover:text-content rounded-lg transition-colors"
              title="Settings"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <Dashboard />
    </main>

    <!-- Version footer -->
    <footer v-if="store.versionInfo" class="max-w-7xl mx-auto px-4 pb-4 text-center">
      <span class="text-xs text-content-ghost">{{ store.versionInfo.version }}<template v-if="!store.versionInfo.isTagged"> &middot; {{ store.versionInfo.buildDate }}</template></span>
    </footer>

    <DropZone />

    <ModalDialog
      :open="showSettings"
      title="Settings"
      panel-class="overflow-y-auto"
      body-class="p-6"
      @close="showSettings = false"
    >
      <template #actions>
        <Transition
          enter-active-class="transition-opacity duration-200"
          leave-active-class="transition-opacity duration-200"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <span
            v-if="settingsSaveMessage"
            class="text-sm"
            :class="settingsSaveMessage.error ? 'text-danger-accent' : 'text-primary-accent'"
          >
            {{ settingsSaveMessage.text }}
          </span>
        </Transition>
      </template>
      <template #actions-end>
        <button
          @click="saveSettings"
          :disabled="settingsSaving || !settingsFormReady"
          class="px-4 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 disabled:cursor-not-allowed border border-primary text-on-accent rounded-lg text-xs font-medium transition-colors"
        >
          {{ settingsSaving ? 'Saving...' : 'Save' }}
        </button>
      </template>
      <Settings ref="settingsRef" @close="showSettings = false" />
    </ModalDialog>

    <ModalDialog
      :open="showEventLog"
      title="Event Log"
      panel-class="overflow-hidden flex flex-col"
      body-class="flex-1 overflow-y-auto"
      @close="showEventLog = false"
    >
      <EventLog />
    </ModalDialog>
  </div>
</template>
