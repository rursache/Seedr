<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { useSeedrStore } from '../stores/seedr';

const emit = defineEmits<{ close: [] }>();

const store = useSeedrStore();

const form = ref({
  client: '',
  port: 49152,
  minUploadRate: 100,
  maxUploadRate: 500,
  simultaneousSeed: -1,
  keepTorrentWithZeroLeechers: true,
  skipIfNoPeers: true,
  minLeechers: 1,
  minSeeders: 1,
  uploadRatioTarget: -1,
});

const showFileName = ref(localStorage.getItem('showFileName') === 'true');
const saving = ref(false);
const saveMessage = ref<{ text: string; error: boolean } | null>(null);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

onUnmounted(() => clearTimeout(savedTimer));

watch(
  () => store.config,
  (cfg) => {
    if (cfg) {
      form.value = { ...cfg };
    }
  },
  { immediate: true }
);

const speedWarning = computed(() => {
  if (form.value.minUploadRate > form.value.maxUploadRate) {
    return 'Min upload rate is higher than max';
  }
  return null;
});

const seedWarning = computed(() => {
  if (form.value.simultaneousSeed === 0) {
    return 'Must be -1 (unlimited) or at least 1';
  }
  return null;
});

const formReady = computed(() => store.configLoaded && form.value.client !== '');

function toggleFileName() {
  showFileName.value = !showFileName.value;
  localStorage.setItem('showFileName', String(showFileName.value));
}

async function save() {
  saving.value = true;
  saveMessage.value = null;
  clearTimeout(savedTimer);
  try {
    await store.updateConfig(form.value);
    saveMessage.value = { text: 'Settings saved', error: false };
    savedTimer = setTimeout(() => { saveMessage.value = null; emit('close'); }, 800);
  } catch {
    saveMessage.value = { text: 'Failed to save settings', error: true };
    savedTimer = setTimeout(() => { saveMessage.value = null; }, 3000);
  } finally {
    saving.value = false;
  }
}

defineExpose({ save, saving, saveMessage, formReady, speedWarning, seedWarning });
</script>

<template>
  <div>
    <div v-if="!store.configLoaded" class="text-gray-500 text-sm py-8 text-center">
      Loading configuration...
    </div>

    <div v-else class="space-y-6">

      <!-- UI section -->
      <div class="space-y-3">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Interface</h3>

        <label class="flex items-center justify-between cursor-pointer group py-1">
          <span class="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">Show filename instead of torrent title</span>
          <button
            type="button"
            role="switch"
            :aria-checked="showFileName"
            @click="toggleFileName()"
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
            :class="showFileName ? 'bg-emerald-600' : 'bg-gray-700'"
          >
            <span
              class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
              :class="showFileName ? 'translate-x-[18px]' : 'translate-x-[3px]'"
            />
          </button>
        </label>
      </div>

      <!-- Two-column grid -->
      <div class="border-t border-gray-800 pt-5 grid grid-cols-1 md:grid-cols-2 gap-8">

        <!-- Left column: Client Emulation -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Client Emulation</h3>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Client Profile</label>
            <select
              v-model="form.client"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option v-for="c in store.clients" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">
              Port <span class="text-gray-600 font-normal ml-1.5">(0 = random)</span>
            </label>
            <input
              v-model.number="form.port"
              type="number"
              min="0"
              max="65535"
              placeholder="49152"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Min Upload <span class="text-gray-600 font-normal ml-1.5">(KB/s)</span></label>
              <input
                v-model.number="form.minUploadRate"
                type="number"
                min="0"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Max Upload <span class="text-gray-600 font-normal ml-1.5">(KB/s)</span></label>
              <input
                v-model.number="form.maxUploadRate"
                type="number"
                min="0"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
          <p v-if="speedWarning" class="text-xs text-amber-400 -mt-2">{{ speedWarning }}</p>
        </div>

        <!-- Right column: Seeding Rules -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Seeding Rules</h3>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Simultaneous Seeds <span class="text-gray-600 font-normal ml-1.5">(-1 = all)</span></label>
            <input
              v-model.number="form.simultaneousSeed"
              type="number"
              min="-1"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <p v-if="seedWarning" class="text-xs text-amber-400 -mt-2">{{ seedWarning }}</p>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Ratio Target <span class="text-gray-600 font-normal ml-1.5">(-1 = unlimited)</span></label>
            <input
              v-model.number="form.uploadRatioTarget"
              type="number"
              step="0.1"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Min Leechers</label>
              <input
                v-model.number="form.minLeechers"
                type="number"
                min="0"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Min Seeders</label>
              <input
                v-model.number="form.minSeeders"
                type="number"
                min="0"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Toggles (full width) -->
      <div class="border-t border-gray-800 pt-5 space-y-3">
        <label class="flex items-center justify-between cursor-pointer group py-1">
          <span class="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">Keep torrents with zero leechers</span>
          <button
            type="button"
            role="switch"
            :aria-checked="form.keepTorrentWithZeroLeechers"
            @click="form.keepTorrentWithZeroLeechers = !form.keepTorrentWithZeroLeechers"
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
            :class="form.keepTorrentWithZeroLeechers ? 'bg-emerald-600' : 'bg-gray-700'"
          >
            <span
              class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
              :class="form.keepTorrentWithZeroLeechers ? 'translate-x-[18px]' : 'translate-x-[3px]'"
            />
          </button>
        </label>

        <label class="flex items-center justify-between cursor-pointer group py-1">
          <span class="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">Skip upload if no peers</span>
          <button
            type="button"
            role="switch"
            :aria-checked="form.skipIfNoPeers"
            @click="form.skipIfNoPeers = !form.skipIfNoPeers"
            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
            :class="form.skipIfNoPeers ? 'bg-emerald-600' : 'bg-gray-700'"
          >
            <span
              class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
              :class="form.skipIfNoPeers ? 'translate-x-[18px]' : 'translate-x-[3px]'"
            />
          </button>
        </label>

      </div>

    </div>
  </div>
</template>
