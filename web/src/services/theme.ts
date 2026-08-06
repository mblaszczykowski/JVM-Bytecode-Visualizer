/**
 * Which of the two palettes the interface is painted in.
 *
 * `system` is the default and the honest one: the reader already told their operating system
 * whether they want light or dark, and an application that ignores that answer is asking the
 * same question twice. The two explicit values exist because the answer is not always right —
 * a dark room, a projector, a screenshot for a bug report.
 *
 * Nothing here knows any colour. The whole theme is a pair of `light-dark()` values per token
 * in `index.css`, selected by the `color-scheme` property; this module only decides which of
 * the three `color-scheme` rules applies, by setting or clearing one attribute on `<html>`.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'jbv:theme';

/** The order the toolbar control cycles through, starting from wherever it currently is. */
export const THEME_ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The stored choice, or `system` when there is none.
 *
 * Reading `localStorage` throws rather than returning null in a browser with site data
 * blocked, and in that browser the theme is simply not remembered — which is a smaller
 * failure than the application not starting.
 */
export function storedTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Pin the choice on `<html>`, where the `color-scheme` rules in `index.css` can see it.
 *
 * `system` removes the attribute rather than setting a third value: with nothing set, the
 * `:root` rule's `color-scheme: light dark` applies and the browser follows the OS, including
 * for the scrollbars and form controls it draws itself.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Site data is blocked. The theme still applies for this tab; it just is not remembered.
  }
}

/** The next value in the cycle, wrapping back to the start. */
export function nextTheme(current: ThemeChoice): ThemeChoice {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system';
}

/** What the control says it will do, which is the value it is about to move to. */
export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};
