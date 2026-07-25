import { ref, watchEffect } from 'vue';
import { useSeedrStore } from '../stores/seedr';
import { resolveTheme, resolveColorStyle } from '../themes';

/**
 * Unsaved selection from the settings form. While it is set it wins over the
 * stored config, so the dropdowns preview instantly; clearing it snaps back to
 * what is saved, which is what closing settings without saving should do.
 */
const previewTheme = ref<string | null>(null);
const previewColorStyle = ref<string | null>(null);

export function previewAppearance(theme: string | null, colorStyle: string | null): void {
  previewTheme.value = theme;
  previewColorStyle.value = colorStyle;
}

export function clearAppearancePreview(): void {
  previewTheme.value = null;
  previewColorStyle.value = null;
}

/** Tracks the OS preference so the auto colour style follows it live. */
const prefersDark = ref(true);
if (typeof window !== 'undefined' && window.matchMedia) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  prefersDark.value = query.matches;
  query.addEventListener('change', (e) => { prefersDark.value = e.matches; });
}

/**
 * Reflects the chosen appearance onto the root element, where the token
 * overrides in style.css key off it. data-theme picks the palette and
 * data-color-style picks whether it renders light or dark, already resolved so
 * the CSS never has to reason about auto.
 */
export function useTheme(): void {
  const store = useSeedrStore();

  watchEffect(() => {
    const theme = resolveTheme(previewTheme.value ?? store.config?.theme);
    const style = resolveColorStyle(previewColorStyle.value ?? store.config?.colorStyle);
    const resolved = style === 'auto' ? (prefersDark.value ? 'dark' : 'light') : style;

    const root = document.documentElement;
    root.dataset['theme'] = theme;
    root.dataset['colorStyle'] = resolved;
  });
}
