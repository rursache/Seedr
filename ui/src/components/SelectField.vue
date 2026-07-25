<script setup lang="ts">
export interface SelectOption {
  value: string;
  label: string;
}

defineProps<{ label: string; options: SelectOption[] }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div>
    <label class="block text-sm font-medium text-content-strong mb-1">{{ label }}</label>
    <div class="relative">
      <!--
        The native chevron sits hard against the control's edge and ignores
        padding, so it is replaced with one that matches the text inset and
        follows the theme through currentColor.
      -->
      <select
        v-model="model"
        class="w-full appearance-none bg-surface-input border border-line rounded-lg pl-3 pr-9 py-2 text-sm text-content focus:outline-none focus:border-primary-strong transition-colors"
      >
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <svg
        class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-secondary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  </div>
</template>
