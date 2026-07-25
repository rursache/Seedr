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
        <div class="absolute inset-0 bg-scrim/60" @click="$emit('close')"></div>
        <Transition
          appear
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 scale-95 translate-y-4"
          leave-to-class="opacity-0 scale-95 translate-y-4"
        >
          <div
            class="relative bg-surface border border-line-subtle rounded-xl shadow-2xl w-full max-w-4xl max-h-[84vh] mx-4"
            :class="panelClass"
          >
            <div class="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-line-subtle px-6 py-4 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <h2 class="text-lg font-bold text-content">{{ title }}</h2>
                <slot name="title-extra" />
              </div>
              <div class="flex items-center gap-3">
                <slot name="actions" />
                <button
                  @click="$emit('close')"
                  class="px-4 py-1.5 bg-surface-input hover:bg-surface-hover border border-line text-content-strong hover:text-content rounded-lg text-xs font-medium transition-colors"
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
