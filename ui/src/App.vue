<script setup lang="ts">
import { useSeedrStore } from './stores/seedr';
import { onMounted, onUnmounted, ref, computed } from 'vue';
import Dashboard from './views/Dashboard.vue';
import Settings from './views/Settings.vue';
import TorrentUpload from './components/TorrentUpload.vue';
import EventLog from './components/EventLog.vue';

const store = useSeedrStore();
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

// Global drag-and-drop
const dragging = ref(false);
const dropMessage = ref<{ text: string; error: boolean } | null>(null);
let dragLeaveTimer: ReturnType<typeof setTimeout> | undefined;
let messageTimer: ReturnType<typeof setTimeout> | undefined;

function onDragEnter(e: DragEvent) {
  // Only react to file drags
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  clearTimeout(dragLeaveTimer);
  dragging.value = true;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function onDragLeave() {
  // Small delay to avoid flicker when moving between child elements
  dragLeaveTimer = setTimeout(() => { dragging.value = false; }, 50);
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  clearTimeout(dragLeaveTimer);

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const torrentFiles = [...files].filter((f) => f.name.endsWith('.torrent'));
  if (torrentFiles.length === 0) {
    showDropMessage('No .torrent files found', true);
    return;
  }

  let uploaded = 0;
  let failed = 0;
  for (const file of torrentFiles) {
    try {
      await store.uploadTorrent(file);
      uploaded++;
    } catch {
      failed++;
    }
  }

  if (failed > 0) {
    showDropMessage(`Uploaded ${uploaded}, failed ${failed}`, true);
  } else if (uploaded === 1) {
    showDropMessage('Torrent uploaded');
  } else {
    showDropMessage(`${uploaded} torrents uploaded`);
  }
}

function showDropMessage(text: string, error = false) {
  clearTimeout(messageTimer);
  dropMessage.value = { text, error };
  messageTimer = setTimeout(() => { dropMessage.value = null; }, 3000);
}

onMounted(() => {
  store.fetchConfig();
  store.fetchClients();
  store.fetchStatus();
  store.fetchTorrents();
  store.fetchVersion();

  document.addEventListener('dragenter', onDragEnter);
});

onUnmounted(() => {
  document.removeEventListener('dragenter', onDragEnter);
  clearTimeout(dragLeaveTimer);
  clearTimeout(messageTimer);
});
</script>

<template>
  <div class="min-h-screen bg-gray-950">
    <!-- Navigation -->
    <nav class="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center justify-between h-14">
          <!-- Left: Logo + connection status -->
          <div class="flex items-center gap-2 md:gap-4">
            <img src="/favicon.svg" alt="Seedr" class="h-6 w-6" />
            <span class="text-lg font-bold text-white tracking-tight">Seedr</span>
            <span
              class="flex items-center gap-1.5 text-xs"
              :class="store.connected ? 'text-emerald-400/70' : 'text-red-400/70'"
            >
              <span class="w-1.5 h-1.5 rounded-full" :class="store.connected ? 'bg-emerald-400' : 'bg-red-400'"></span>
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
              class="px-2 md:px-3 py-1.5 bg-red-500/50 hover:bg-red-500/70 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              <span class="hidden md:inline">{{ store.actionPending ? 'Stopping...' : 'Stop Seeding' }}</span>
              <span class="md:hidden">{{ store.actionPending ? '...' : 'Stop' }}</span>
            </button>
            <button
              v-else
              @click="store.startSeeding()"
              :disabled="store.actionPending || store.torrents.length === 0"
              class="px-2 md:px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              <span class="hidden md:inline">{{ store.actionPending ? 'Starting...' : 'Start Seeding' }}</span>
              <span class="md:hidden">{{ store.actionPending ? '...' : 'Start' }}</span>
            </button>

            <!-- Upload Torrent -->
            <TorrentUpload />

            <!-- Divider -->
            <div class="w-px h-5 bg-gray-700/50"></div>

            <!-- Event Log -->
            <button
              @click="openEventLog()"
              class="relative w-[30px] h-[30px] flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
              title="Event Log"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 2l1.88 1.88" /><path d="M14.12 3.88 16 2" />
                <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
                <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
                <path d="M12 20v-9" /><path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
                <path d="M6 13H2" /><path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
                <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" /><path d="M22 13h-4" />
                <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
              </svg>
              <span
                v-if="hasErrors"
                class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"
              ></span>
            </button>

            <!-- Settings -->
            <button
              @click="showSettings = true"
              class="hidden md:block px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
            >
              Settings
            </button>
            <button
              @click="showSettings = true"
              class="md:hidden w-[30px] h-[30px] flex items-center justify-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
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
      <span class="text-xs text-gray-700">{{ store.versionInfo.version }}<template v-if="!store.versionInfo.isTagged"> &middot; {{ store.versionInfo.buildDate }}</template></span>
    </footer>

    <!-- Drop feedback toast -->
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="dropMessage"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium"
        :class="dropMessage.error ? 'bg-red-900/90 text-red-200' : 'bg-emerald-900/90 text-emerald-200'"
      >
        {{ dropMessage.text }}
      </div>
    </Transition>

    <!-- Full-page drop overlay -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        leave-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="dragging"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/80 backdrop-blur-sm"
          @dragover.prevent="onDragOver"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div class="border-2 border-dashed border-emerald-500/50 rounded-2xl px-16 py-12 text-center pointer-events-none">
            <div class="text-emerald-400 text-lg font-semibold">Drop .torrent files</div>
            <div class="text-gray-500 text-sm mt-1">Files will be uploaded automatically</div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Settings Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        leave-active-class="transition-all duration-150 ease-in"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showSettings"
          class="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
        >
          <div class="absolute inset-0 bg-black/60" @click="showSettings = false"></div>
          <Transition
            appear
            enter-active-class="transition-all duration-200 ease-out"
            leave-active-class="transition-all duration-150 ease-in"
            enter-from-class="opacity-0 scale-95 translate-y-4"
            leave-to-class="opacity-0 scale-95 translate-y-4"
          >
            <div class="relative bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[84vh] overflow-y-auto mx-4">
              <div class="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                <h2 class="text-lg font-bold text-white">Settings</h2>
                <div class="flex items-center gap-3">
                  <Transition
                    enter-active-class="transition-opacity duration-200"
                    leave-active-class="transition-opacity duration-200"
                    enter-from-class="opacity-0"
                    leave-to-class="opacity-0"
                  >
                    <span
                      v-if="settingsSaveMessage"
                      class="text-sm"
                      :class="settingsSaveMessage.error ? 'text-red-400' : 'text-emerald-400'"
                    >
                      {{ settingsSaveMessage.text }}
                    </span>
                  </Transition>
                  <button
                    @click="showSettings = false"
                    class="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Close
                  </button>
                  <button
                    @click="saveSettings"
                    :disabled="settingsSaving || !settingsFormReady"
                    class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-600 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {{ settingsSaving ? 'Saving...' : 'Save' }}
                  </button>
                </div>
              </div>
              <div class="p-6">
                <Settings ref="settingsRef" @close="showSettings = false" />
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
    <!-- Event Log Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        leave-active-class="transition-all duration-150 ease-in"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showEventLog"
          class="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
        >
          <div class="absolute inset-0 bg-black/60" @click="showEventLog = false"></div>
          <Transition
            appear
            enter-active-class="transition-all duration-200 ease-out"
            leave-active-class="transition-all duration-150 ease-in"
            enter-from-class="opacity-0 scale-95 translate-y-4"
            leave-to-class="opacity-0 scale-95 translate-y-4"
          >
            <div class="relative bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[84vh] overflow-hidden mx-4 flex flex-col">
              <div class="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-6 py-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <h2 class="text-lg font-bold text-white">Event Log</h2>
                  <span class="text-xs text-gray-600">({{ store.events.length }})</span>
                </div>
                <button
                  @click="showEventLog = false"
                  class="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Close
                </button>
              </div>
              <div class="flex-1 overflow-y-auto">
                <EventLog />
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
