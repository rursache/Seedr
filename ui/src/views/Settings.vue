<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { useSeedrStore } from '../stores/seedr';

const store = useSeedrStore();

const form = ref({
  client: '',
  port: 49152,
  minUploadRate: 100,
  maxUploadRate: 500,
  simultaneousSeed: 10,
  keepTorrentWithZeroLeechers: true,
  skipIfNoPeers: true,
  minLeechers: 0,
  uploadRatioTarget: -1,
});

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

async function save() {
  saving.value = true;
  saveMessage.value = null;
  clearTimeout(savedTimer);
  try {
    await store.updateConfig(form.value);
    saveMessage.value = { text: 'Settings saved', error: false };
  } catch {
    saveMessage.value = { text: 'Failed to save settings', error: true };
  } finally {
    saving.value = false;
    savedTimer = setTimeout(() => { saveMessage.value = null; }, 3000);
  }
}
</script>

<template>
  <div class="space-y-5">

    <div v-if="!store.configLoaded" class="text-gray-500 text-sm">
      Loading configuration...
    </div>

    <div v-else class="space-y-5">
      <!-- Client -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">Client Profile</label>
        <select
          v-model="form.client"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        >
          <option v-for="c in store.clients" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>

      <!-- Port -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          Port <span class="text-gray-500">(0 = random, default 49152)</span>
        </label>
        <input
          v-model.number="form.port"
          type="number"
          min="0"
          max="65535"
          placeholder="49152"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      <!-- Speed -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Min Upload (KB/s)</label>
          <input
            v-model.number="form.minUploadRate"
            type="number"
            min="0"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Max Upload (KB/s)</label>
          <input
            v-model.number="form.maxUploadRate"
            type="number"
            min="0"
            class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>
      <p v-if="speedWarning" class="text-xs text-amber-400 -mt-3">{{ speedWarning }}</p>

      <!-- Simultaneous Seeds -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          Simultaneous Seeds <span class="text-gray-500">(-1 = all)</span>
        </label>
        <input
          v-model.number="form.simultaneousSeed"
          type="number"
          min="-1"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      <p v-if="seedWarning" class="text-xs text-amber-400 -mt-3">{{ seedWarning }}</p>

      <!-- Min Leechers -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          Min Leechers <span class="text-gray-500">(require N leechers to report upload)</span>
        </label>
        <input
          v-model.number="form.minLeechers"
          type="number"
          min="0"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      <!-- Upload Ratio Target -->
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1">
          Upload Ratio Target <span class="text-gray-500">(-1 = unlimited)</span>
        </label>
        <input
          v-model.number="form.uploadRatioTarget"
          type="number"
          step="0.1"
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
        />
      </div>

      <!-- Toggles -->
      <div class="space-y-3">
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            v-model="form.keepTorrentWithZeroLeechers"
            type="checkbox"
            class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500"
          />
          <span class="text-sm text-gray-300">Keep torrents with zero leechers</span>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input
            v-model="form.skipIfNoPeers"
            type="checkbox"
            class="w-4 h-4 rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500"
          />
          <span class="text-sm text-gray-300">Skip upload if no peers (safety)</span>
        </label>
      </div>

      <div class="flex items-center gap-3">
        <button
          @click="save"
          :disabled="saving || !formReady || !!speedWarning || !!seedWarning"
          class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
        >
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
        <span
          v-if="saveMessage"
          class="text-sm"
          :class="saveMessage.error ? 'text-red-400' : 'text-emerald-400'"
        >
          {{ saveMessage.text }}
        </span>
      </div>
    </div>
  </div>
</template>
