<script setup lang="ts">
/**
 * Teleported modal shell: backdrop, transitions and header chrome. Callers
 * supply the title, any header-right controls and the body.
 */
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** Extra classes for the panel, e.g. how it handles overflow */
    panelClass?: string;
    /** Extra classes for the body wrapper */
    bodyClass?: string;
  }>(),
  { panelClass: '', bodyClass: '' }
);

defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]">
        <div class="absolute inset-0 bg-black/60" @click="$emit('close')"></div>
        <Transition
          appear
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 scale-95 translate-y-4"
          leave-to-class="opacity-0 scale-95 translate-y-4"
        >
          <div
            class="relative bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[84vh] mx-4"
            :class="panelClass"
          >
            <div class="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-6 py-4 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <h2 class="text-lg font-bold text-white">{{ title }}</h2>
                <slot name="title-extra" />
              </div>
              <div class="flex items-center gap-3">
                <slot name="actions" />
                <button
                  @click="$emit('close')"
                  class="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Close
                </button>
                <slot name="actions-end" />
              </div>
            </div>
            <div :class="bodyClass">
              <slot />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
