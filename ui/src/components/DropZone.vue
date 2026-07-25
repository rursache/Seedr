<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSeedrStore } from '../stores/seedr';

const store = useSeedrStore();

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

function onDragLeave() {
  // Small delay to avoid flicker when moving between child elements
  dragLeaveTimer = setTimeout(() => { dragging.value = false; }, 50);
}

async function onDrop(e: DragEvent) {
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

onMounted(() => document.addEventListener('dragenter', onDragEnter));

onUnmounted(() => {
  document.removeEventListener('dragenter', onDragEnter);
  clearTimeout(dragLeaveTimer);
  clearTimeout(messageTimer);
});
</script>

<template>
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
      :class="dropMessage.error ? 'bg-danger-soft/90 text-danger-brightest' : 'bg-primary-soft/90 text-primary-brightest'"
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
        class="fixed inset-0 z-[60] flex items-center justify-center bg-surface/80 backdrop-blur-sm"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div class="border-2 border-dashed border-primary-strong/50 rounded-2xl px-16 py-12 text-center pointer-events-none">
          <div class="text-primary-accent text-lg font-semibold">Drop .torrent files</div>
          <div class="text-content-muted text-sm mt-1">Files will be uploaded automatically</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
