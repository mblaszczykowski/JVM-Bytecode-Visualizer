import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyTheme,
  nextTheme,
  storedTheme,
  storeTheme,
  THEME_LABELS,
  THEME_ORDER,
  THEME_STORAGE_KEY,
} from './theme';

function statedChromeColours(): void {
  document.head.innerHTML =
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f7" data-scheme="light">' +
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#08090a" data-scheme="dark">';
}

function chromeOverride(): string | undefined {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    ?.content;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('storedTheme', () => {
  it('matches the system until the reader chooses otherwise', () => {
    expect(storedTheme()).toBe('system');
  });

  it('reads back what was stored', () => {
    storeTheme('dark');

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(storedTheme()).toBe('dark');
  });

  it('ignores a value no version of this application wrote', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');

    expect(storedTheme()).toBe('system');
  });

  it('matches the system where storage is blocked rather than failing to start', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked in this context');
    });

    expect(storedTheme()).toBe('system');
  });
});

describe('storeTheme', () => {
  it('carries on where the choice cannot be remembered', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('the quota is exhausted');
    });

    expect(() => {
      storeTheme('light');
    }).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('states the choice on the root element', () => {
    applyTheme('dark');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('says nothing at all when the reader follows the system', () => {
    applyTheme('light');
    applyTheme('system');

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('repaints the browser chrome to match an explicit choice', () => {
    statedChromeColours();

    applyTheme('dark');
    expect(chromeOverride()).toBe('#08090a');

    applyTheme('light');
    expect(chromeOverride()).toBe('#f4f5f7');
  });

  it('puts the override ahead of the media-scoped pair the browser reads in order', () => {
    statedChromeColours();

    applyTheme('dark');

    const metas = [...document.head.querySelectorAll('meta[name="theme-color"]')];
    expect(metas).toHaveLength(3);
    expect(metas[0]?.hasAttribute('media')).toBe(false);
  });

  it('hands the browser back to the media queries when the reader follows the system', () => {
    statedChromeColours();

    applyTheme('dark');
    applyTheme('system');

    expect(chromeOverride()).toBeUndefined();
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  });

  it('carries on where the page states no chrome colour to copy', () => {
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
    expect(chromeOverride()).toBeUndefined();
  });
});

describe('nextTheme', () => {
  it('cycles through every choice and back to the first', () => {
    expect(THEME_ORDER).toEqual(['system', 'light', 'dark']);
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('names every choice for the control that offers it', () => {
    expect(THEME_ORDER.map((option) => THEME_LABELS[option])).toEqual([
      'Match system',
      'Light',
      'Dark',
    ]);
  });
});
