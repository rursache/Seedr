<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { useSeedrStore } from '../stores/seedr';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import SelectField from '../components/SelectField.vue';
import { THEMES, COLOR_STYLES, DEFAULT_THEME, DEFAULT_COLOR_STYLE } from '../themes';
import { previewAppearance, clearAppearancePreview } from '../composables/useTheme';
import {
  validatePort,
  validateUploadRates,
  validateSimultaneousSeed,
  validateRotationInterval,
  validateRatioTarget,
  validatePeerCounts,
} from '../utils/settings-validation';

const emit = defineEmits<{ close: [] }>();

const store = useSeedrStore();

const form = ref({
  client: '',
  port: 49152,
  minUploadRate: 100,
  maxUploadRate: 500,
  simultaneousSeed: -1,
  seedRotationInterval: 15,
  keepTorrentWithZeroLeechers: true,
  skipIfNoPeers: true,
  minLeechers: 1,
  minSeeders: 1,
  uploadRatioTarget: -1,
  showFileName: true,
  theme: DEFAULT_THEME,
  colorStyle: DEFAULT_COLOR_STYLE,
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

const portWarning = computed(() => validatePort(form.value.port));

const speedWarning = computed(() =>
  validateUploadRates(form.value.minUploadRate, form.value.maxUploadRate)
);

const seedWarning = computed(() => validateSimultaneousSeed(form.value.simultaneousSeed));

const rotationWarning = computed(() =>
  validateRotationInterval(form.value.seedRotationInterval, form.value.simultaneousSeed)
);

const ratioWarning = computed(() => validateRatioTarget(form.value.uploadRatioTarget));

const themeOptions = computed(() => THEMES.map((t) => ({ value: t.id, label: t.label })));

const colorStyleOptions = computed(() => COLOR_STYLES.map((s) => ({ value: s.id, label: s.label })));

// Appearance previews as soon as it is picked, and reverts if the panel is
// closed without saving. Saving persists it to config.json like any other field.
watch(
  () => [form.value.theme, form.value.colorStyle] as const,
  ([theme, colorStyle]) => previewAppearance(theme, colorStyle)
);

onUnmounted(clearAppearancePreview);

const clientOptions = computed(() => store.clients.map((c) => ({ value: c, label: c })));

const peerWarning = computed(() =>
  validatePeerCounts(form.value.minLeechers, form.value.minSeeders)
);

const hasWarnings = computed(() =>
  !!(portWarning.value || speedWarning.value || seedWarning.value || rotationWarning.value || ratioWarning.value || peerWarning.value)
);

const formReady = computed(() => store.configLoaded && form.value.client !== '' && !hasWarnings.value);

async function save() {
  saving.value = true;
  saveMessage.value = null;
  clearTimeout(savedTimer);
  if (!form.value.port) form.value.port = 49152;
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

defineExpose({ save, saving, saveMessage, formReady, portWarning, speedWarning, seedWarning, rotationWarning, ratioWarning, peerWarning });
</script>

<template>
  <div>
    <div v-if="!store.configLoaded" class="text-content-muted text-sm py-8 text-center">
      Loading configuration...
    </div>

    <div v-else class="space-y-6">

      <!-- UI section -->
      <div class="space-y-3">
        <h3 class="text-xs font-semibold text-content-muted uppercase tracking-wider">Interface</h3>

        <ToggleSwitch v-model="form.showFileName" label="Show filename instead of torrent title" />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <SelectField v-model="form.theme" label="Theme" :options="themeOptions" />
          <SelectField v-model="form.colorStyle" label="Color Style" :options="colorStyleOptions" />
        </div>
      </div>

      <!-- Two-column grid -->
      <div class="border-t border-line-subtle pt-5 grid grid-cols-1 md:grid-cols-2 gap-8">

        <!-- Left column: Client Emulation -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-content-muted uppercase tracking-wider">Client Emulation</h3>

          <SelectField v-model="form.client" label="Client Profile" :options="clientOptions" />

          <div>
            <label class="block text-sm font-medium text-content-strong mb-1">Port</label>
            <input
              v-model.number="form.port"
              type="number"
              min="1"
              max="65535"
              placeholder="49152"
              class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
            />
          </div>
          <p v-if="portWarning" class="text-xs text-warning-accent -mt-2">{{ portWarning }}</p>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Min Upload <span class="text-content-faint font-normal ml-1.5">(KB/s)</span></label>
              <input
                v-model.number="form.minUploadRate"
                type="number"
                min="0"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Max Upload <span class="text-content-faint font-normal ml-1.5">(KB/s)</span></label>
              <input
                v-model.number="form.maxUploadRate"
                type="number"
                min="0"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
              />
            </div>
          </div>
          <p v-if="speedWarning" class="text-xs text-warning-accent -mt-2">{{ speedWarning }}</p>
        </div>

        <!-- Right column: Seeding Rules -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold text-content-muted uppercase tracking-wider">Seeding Rules</h3>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Max Active Torrents <span class="text-content-faint font-normal ml-1.5">(-1 = all)</span></label>
              <input
                v-model.number="form.simultaneousSeed"
                type="number"
                min="-1"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Rotation Interval <span class="text-content-faint font-normal ml-1.5">(minutes)</span></label>
              <input
                v-model.number="form.seedRotationInterval"
                type="number"
                min="1"
                max="999999"
                :disabled="form.simultaneousSeed === -1"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              />
            </div>
          </div>
          <p v-if="seedWarning" class="text-xs text-warning-accent -mt-2">{{ seedWarning }}</p>
          <p v-if="rotationWarning" class="text-xs text-warning-accent -mt-2">{{ rotationWarning }}</p>

          <div>
            <label class="block text-sm font-medium text-content-strong mb-1">Ratio Target <span class="text-content-faint font-normal ml-1.5">(-1 = unlimited)</span></label>
            <input
              v-model.number="form.uploadRatioTarget"
              type="number"
              step="0.1"
              class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
            />
          </div>
          <p v-if="ratioWarning" class="text-xs text-warning-accent -mt-2">{{ ratioWarning }}</p>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Min Leechers</label>
              <input
                v-model.number="form.minLeechers"
                type="number"
                min="0"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-content-strong mb-1">Min Seeders</label>
              <input
                v-model.number="form.minSeeders"
                type="number"
                min="0"
                class="w-full bg-surface-input border border-line rounded-lg px-3 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
              />
            </div>
          </div>
          <p v-if="peerWarning" class="text-xs text-warning-accent -mt-2">{{ peerWarning }}</p>
        </div>
      </div>

      <!-- Toggles (full width) -->
      <div class="border-t border-line-subtle pt-5 space-y-3">
        <ToggleSwitch v-model="form.keepTorrentWithZeroLeechers" label="Keep torrents with zero leechers" />
        <ToggleSwitch v-model="form.skipIfNoPeers" label="Skip upload if no peers" />
      </div>

    </div>
  </div>
</template>
