<script setup lang="ts">
defineProps<{ label: string }>();
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="flex items-center justify-between cursor-pointer group py-1">
    <span class="text-sm text-content-secondary group-hover:text-content-strong transition-colors">{{ label }}</span>
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      @click="model = !model"
      class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
      :class="model ? 'bg-primary' : 'bg-surface-hover'"
    >
      <span
        class="inline-block h-3.5 w-3.5 rounded-full bg-on-accent shadow transition-transform duration-200"
        :class="model ? 'translate-x-[18px]' : 'translate-x-[3px]'"
      />
    </button>
  </label>
</template>
