import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  THEMES,
  DEFAULT_THEME,
  DEFAULT_COLOR_STYLE,
  COLOR_STYLES,
  resolveTheme,
  resolveColorStyle,
} from '../ui/src/themes';

const uiPath = (rel: string) => fileURLToPath(new URL(`../ui/src/${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(uiPath(rel), 'utf-8');

const entry = read('style.css');
const themeDir = 'styles/themes';

/** Token names declared inside the first block matching a selector, or null. */
function tokensIn(css: string, selector: string): Set<string> | null {
  const escaped = selector.replace(/[[\]().*+?^$|\\{}]/g, '\\$&');
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) return null;
  return new Set(Array.from(block[1]!.matchAll(/(--color-[a-z0-9-]+)\s*:/g), (m) => m[1]!));
}

const cssFor = (id: string) => read(`${themeDir}/${id}.css`);

/** The default theme declares the tokens; every other theme overrides them. */
const baseTokens = tokensIn(cssFor(DEFAULT_THEME), '@theme')!;
const extraThemes = THEMES.filter((t) => t.id !== DEFAULT_THEME);

describe('theme registry', () => {
  it('resolves every registered id to itself', () => {
    for (const theme of THEMES) expect(resolveTheme(theme.id)).toBe(theme.id);
  });

  it('falls back to the default for ids this build does not ship', () => {
    // config.json can hold a theme from a newer build, or be hand-edited
    expect(resolveTheme('no-such-theme')).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme('')).toBe(DEFAULT_THEME);
  });

  it('registers the default theme itself', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  it('uses ids the config schema accepts and labels them', () => {
    // the backend validates against /^[a-z0-9-]+$/ with a 32 char cap
    for (const theme of THEMES) {
      expect(theme.id).toMatch(/^[a-z0-9-]+$/);
      expect(theme.id.length).toBeLessThanOrEqual(32);
      expect(theme.label.trim()).not.toBe('');
    }
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it('defaults the colour style to auto and resolves the rest', () => {
    expect(DEFAULT_COLOR_STYLE).toBe('auto');
    for (const style of COLOR_STYLES) expect(resolveColorStyle(style.id)).toBe(style.id);
    expect(resolveColorStyle('sideways')).toBe(DEFAULT_COLOR_STYLE);
    expect(resolveColorStyle(undefined)).toBe(DEFAULT_COLOR_STYLE);
  });
});

/*
 * The registry, the per-theme file and the entry's import list are three halves
 * of one contract, and nothing at runtime notices when they disagree: a
 * registered id with no CSS silently renders as the default, an unimported file
 * never reaches the bundle, and a theme missing tokens in one colour style
 * silently inherits the other style's values — which is how a dark surface ends
 * up under light text.
 */
describe('theme stylesheet contract', () => {
  it('gives every registered theme a file named after its id', () => {
    for (const theme of THEMES) {
      expect(existsSync(uiPath(`${themeDir}/${theme.id}.css`)), `${themeDir}/${theme.id}.css`).toBe(
        true
      );
    }
  });

  it('imports every theme file from the entry stylesheet', () => {
    for (const theme of THEMES) {
      expect(entry, `style.css does not import ${theme.id}`).toContain(
        `@import "./${themeDir}/${theme.id}.css"`
      );
    }
  });

  it('has no theme file that is not registered', () => {
    const onDisk = readdirSync(uiPath(themeDir))
      .filter((f) => f.endsWith('.css'))
      .map((f) => f.replace(/\.css$/, ''));
    const registered = new Set(THEMES.map((t) => t.id));
    expect(onDisk.filter((id) => !registered.has(id))).toEqual([]);
  });

  /*
   * The default theme's file is shaped differently on purpose: Tailwind builds
   * the utility classes from @theme, so that block must hold real values, and
   * they are also what renders before Vue writes data-theme. Its light palette
   * is deliberately not qualified by data-theme so it doubles as the light base.
   */
  it('declares the token vocabulary in the default theme', () => {
    const css = cssFor(DEFAULT_THEME);
    expect(tokensIn(css, '@theme'), `${DEFAULT_THEME}.css has no @theme block`).not.toBeNull();
    expect(baseTokens.size).toBeGreaterThan(30);
    const light = tokensIn(css, ":root[data-color-style='light']");
    expect(light, `${DEFAULT_THEME}.css has no shared light block`).not.toBeNull();
    // the shared light base has to cover the ramps, or a theme inheriting it
    // renders dark surfaces under dark text
    for (const token of ['--color-surface', '--color-content', '--color-content-body']) {
      expect(light!.has(token), `the light base is missing ${token}`).toBe(true);
    }
  });

  it('ships a dark and a light block for every registered theme', () => {
    for (const theme of extraThemes) {
      const css = cssFor(theme.id);
      for (const style of ['dark', 'light']) {
        const selector = `:root[data-theme='${theme.id}'][data-color-style='${style}']`;
        expect(tokensIn(css, selector), `${theme.id} is missing its ${style} block`).not.toBeNull();
      }
    }
  });

  it('defines the same tokens in both colour styles of a theme', () => {
    for (const theme of extraThemes) {
      const css = cssFor(theme.id);
      const dark = tokensIn(css, `:root[data-theme='${theme.id}'][data-color-style='dark']`)!;
      const light = tokensIn(css, `:root[data-theme='${theme.id}'][data-color-style='light']`)!;
      expect([...dark].filter((t) => !light.has(t)), `${theme.id} sets these only in dark`).toEqual(
        []
      );
      expect([...light].filter((t) => !dark.has(t)), `${theme.id} sets these only in light`).toEqual(
        []
      );
    }
  });

  it('only overrides tokens that exist, so no declaration is inert', () => {
    for (const theme of extraThemes) {
      const css = cssFor(theme.id);
      for (const style of ['dark', 'light']) {
        const declared = tokensIn(
          css,
          `:root[data-theme='${theme.id}'][data-color-style='${style}']`
        )!;
        const unknown = [...declared].filter((t) => !baseTokens.has(t));
        expect(unknown, `${theme.id} ${style} overrides tokens absent from @theme`).toEqual([]);
      }
    }
  });

  it('qualifies theme blocks by colour style so they cannot leak across it', () => {
    // A bare :root[data-theme=id] ties with the shared light block on
    // specificity, so import order would decide which wins
    for (const theme of extraThemes) {
      const bare = new RegExp(`:root\\[data-theme='${theme.id}'\\]\\s*\\{`);
      expect(bare.test(cssFor(theme.id)), `${theme.id} has an unqualified block`).toBe(false);
    }
  });

  it('covers the surface and content ramps in every theme', () => {
    // the ramps carry legibility; a theme that redefines surfaces but not text
    // (or the reverse) is the failure this catches
    const ramps = [
      '--color-surface',
      '--color-surface-raised',
      '--color-content',
      '--color-content-body',
      '--color-content-strong',
    ];
    for (const theme of extraThemes) {
      const css = cssFor(theme.id);
      for (const style of ['dark', 'light']) {
        const declared = tokensIn(
          css,
          `:root[data-theme='${theme.id}'][data-color-style='${style}']`
        )!;
        for (const token of ramps) {
          expect(declared.has(token), `${theme.id} ${style} is missing ${token}`).toBe(true);
        }
      }
    }
  });
});
