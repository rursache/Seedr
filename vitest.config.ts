import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The UI keeps its own node_modules, so tests covering ui/src resolve vue and
// pinia from there rather than reaching into their dist files by path
const uiModule = (name: string) =>
  fileURLToPath(new URL(`./ui/node_modules/${name}`, import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      vue: uiModule('vue'),
      pinia: uiModule('pinia'),
    },
  },
});
