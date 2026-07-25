/**
 * Theme registry.
 *
 * To add a theme:
 *   1. add a `:root[data-theme="<id>"]` block in style.css overriding the
 *      tokens it changes — anything it leaves out keeps the default values
 *   2. add an entry here
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
];

export const DEFAULT_THEME = 'midnight';

/** Falls back to the default when config holds an id this build does not ship. */
export function resolveTheme(id: string | undefined | null): string {
  return THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_THEME;
}
