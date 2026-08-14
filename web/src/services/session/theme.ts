export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'jbv:theme';

export const THEME_ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function storedTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

const CHROME_OVERRIDE = 'meta[name="theme-color"]:not([media])';

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
  applyBrowserChrome(choice);
}

function applyBrowserChrome(choice: ThemeChoice): void {
  const { head } = document;
  head.querySelector(CHROME_OVERRIDE)?.remove();
  if (choice === 'system') {
    return;
  }

  const chosen = head.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][data-scheme="${choice}"]`,
  );
  if (chosen === null) {
    return;
  }

  const override = document.createElement('meta');
  override.name = 'theme-color';
  override.content = chosen.content;
  head.prepend(override);
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    return;
  }
}

export function nextTheme(current: ThemeChoice): ThemeChoice {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system';
}

export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};
