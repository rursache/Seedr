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
  <div class="flex items-center gap-3">
    <div
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <button
        @click="openFilePicker"
        :disabled="uploading"
        class="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-gray-300 rounded font-medium text-sm transition-colors"
        :class="{ 'border-emerald-500 bg-emerald-900/20': dragOver }"
      >
        {{ uploading ? 'Uploading...' : 'Upload .torrent' }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".torrent"
        multiple
        class="hidden"
        @change="onFileChange"
      />
    </div>
    <span
      v-if="message"
      class="text-sm"
      :class="message.error ? 'text-red-400' : 'text-emerald-400'"
    >
      {{ message.text }}
    </span>
  </div>
</template>
