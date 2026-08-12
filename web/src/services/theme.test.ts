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

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
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
