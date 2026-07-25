import { watch } from 'vue';
import { useSeedrStore } from '../stores/seedr';
import { resolveTheme } from '../themes';

/**
 * Reflects the configured theme onto the root element as data-theme, which is
 * what the token overrides in style.css key off. Applied eagerly so the theme
 * follows a config change without a reload.
 */
export function useTheme(): void {
  const store = useSeedrStore();

  watch(
    () => store.config?.theme,
    (id) => {
      document.documentElement.dataset['theme'] = resolveTheme(id);
    },
    { immediate: true }
  );
}
