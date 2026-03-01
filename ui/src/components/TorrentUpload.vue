<script setup lang="ts">
import { ref } from 'vue';
import { useSeedrStore } from '../stores/seedr';

const store = useSeedrStore();
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const message = ref<{ text: string; error: boolean } | null>(null);
const dragOver = ref(false);
let messageTimer: ReturnType<typeof setTimeout> | undefined;

function openFilePicker() {
  fileInput.value?.click();
}

function showMessage(text: string, error = false) {
  clearTimeout(messageTimer);
  message.value = { text, error };
  messageTimer = setTimeout(() => { message.value = null; }, 3000);
}

async function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;

  const torrentFiles = [...files].filter((f) => f.name.endsWith('.torrent'));

  if (torrentFiles.length === 0) {
    showMessage('No .torrent files selected', true);
    return;
  }

  uploading.value = true;
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

  uploading.value = false;
  if (fileInput.value) fileInput.value.value = '';

  if (failed > 0) {
    showMessage(`Uploaded ${uploaded}, failed ${failed}`, true);
  } else if (uploaded === 1) {
    showMessage('Torrent uploaded');
  } else {
    showMessage(`${uploaded} torrents uploaded`);
  }
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  handleFiles(target.files);
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  handleFiles(e.dataTransfer?.files ?? null);
}
</script>

<template>
  <div
    class="relative"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <button
      @click="openFilePicker"
      :disabled="uploading"
      class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
      :class="{ 'border-emerald-500 bg-emerald-900/20': dragOver }"
    >
      {{ uploading ? 'Uploading...' : 'Add Torrent' }}
    </button>
    <input
      ref="fileInput"
      type="file"
      accept=".torrent"
      multiple
      class="hidden"
      @change="onFileChange"
    />
    <!-- Upload feedback toast -->
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <span
        v-if="message"
        class="absolute top-full right-0 mt-2 whitespace-nowrap text-xs px-2 py-1 rounded shadow-lg"
        :class="message.error ? 'bg-red-900/90 text-red-300' : 'bg-emerald-900/90 text-emerald-300'"
      >
        {{ message.text }}
      </span>
    </Transition>
  </div>
</template>
