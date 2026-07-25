/**
 * Theme registry.
 *
 * To add a theme:
 *   1. add `styles/themes/<id>.css` holding a pair of blocks, one per colour
 *      style — see the convention documented in styles/tokens.css
 *   2. import it from style.css
 *   3. add an entry here
 *
 * Nothing else needs touching. The backend stores whatever id is selected and
 * does not know the list, so an id it has never seen still round-trips.
 */
export interface ThemeOption {
  id: string;
  label: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'ember', label: 'Ember' },
  { id: 'amethyst', label: 'Amethyst' },
];

export const DEFAULT_THEME = 'midnight';

/** Falls back to the default when config holds an id this build does not ship. */
export function resolveTheme(id: string | undefined | null): string {
  return THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_THEME;
}

/**
 * Colour style is orthogonal to the theme: the theme picks the palette, this
 * picks whether that palette renders light or dark. `auto` follows the OS.
 */
export type ColorStyle = 'auto' | 'light' | 'dark';

export const COLOR_STYLES: { id: ColorStyle; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export const DEFAULT_COLOR_STYLE: ColorStyle = 'auto';

export function resolveColorStyle(id: string | undefined | null): ColorStyle {
  return COLOR_STYLES.some((s) => s.id === id) ? (id as ColorStyle) : DEFAULT_COLOR_STYLE;
}
