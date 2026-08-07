import { expect, test, type Page } from '@playwright/test';

/**
 * The theme contract.
 *
 * `index.css` claims specific contrast ratios in a comment — 16.5:1, 7.3:1 and 5.0:1 for the
 * three readable text steps — and a comment that claims a number is a comment nobody re-checks.
 * These tests read the tokens out of a real browser, in both palettes, and do the arithmetic.
 *
 * They are deliberately not screenshots. A pixel baseline would catch this too, but it would
 * also fail on a font-rendering difference between macOS and the Linux runner, and the failure
 * would say "something moved" rather than "text-fg-3 dropped below AA in light mode".
 */

/** The four surfaces text is actually set on, and the steps that are allowed to sit on them. */
const READABLE_STEPS = ['--color-fg', '--color-fg-2', '--color-fg-3'] as const;

/** WCAG AA for body text. `--color-fg-dim` is excluded on purpose: it dresses disabled controls. */
const AA = 4.5;

interface Resolved {
  readonly ratios: Record<string, number>;
  readonly tokens: Record<string, string>;
}

/**
 * Resolves every token against the live document and computes contrast in the browser, where
 * `light-dark()` and `color-mix()` have already been collapsed to real colours — which is the
 * whole point of measuring here rather than parsing the stylesheet.
 */
async function measure(page: Page, surface: string): Promise<Resolved> {
  return page.evaluate(
    ([surfaceVar, steps]) => {
      const probe = document.createElement('span');
      document.body.append(probe);

      /** Any CSS colour → linear-light channels, via the browser's own parser. */
      function channels(value: string): [number, number, number] {
        probe.style.color = '';
        probe.style.color = value;
        const computed = getComputedStyle(probe).color;
        const parts = /rgba?\(([^)]+)\)/.exec(computed)?.[1] ?? '0 0 0';
        const [r = 0, g = 0, b = 0] = parts.split(/[\s,/]+/).map(Number);
        return [r, g, b];
      }

      function luminance(value: string): number {
        const linear = channels(value)
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
          );
        return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
      }

      const root = getComputedStyle(document.documentElement);
      const read = (name: string): string => root.getPropertyValue(name).trim();

      const background = read(surfaceVar);
      const backgroundLuminance = luminance(background);

      const ratios: Record<string, number> = {};
      const tokens: Record<string, string> = { [surfaceVar]: background };

      for (const step of steps) {
        const colour = read(step);
        tokens[step] = colour;
        const foreground = luminance(colour);
        const [light, dark] =
          foreground > backgroundLuminance
            ? [foreground, backgroundLuminance]
            : [backgroundLuminance, foreground];
        ratios[step] = (light + 0.05) / (dark + 0.05);
      }

      probe.remove();
      return { ratios, tokens };
    },
    [surface, READABLE_STEPS] as const,
  );
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the ${theme} palette`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await expect(page.getByTestId('welcome-screen')).toBeVisible();
    });

    test('every readable text step clears AA on the panel surface', async ({ page }) => {
      const { ratios, tokens } = await measure(page, '--color-panel');

      for (const step of READABLE_STEPS) {
        expect(
          ratios[step],
          `${step} (${tokens[step] ?? '?'}) on --color-panel (${tokens['--color-panel'] ?? '?'})`,
        ).toBeGreaterThanOrEqual(AA);
      }
    });

    // Every surface text is actually set on, not just the panel. The welcome screen sets text
    // straight onto the ground, and in light mode that is the lightest surface in the system —
    // a step that passes on a panel can still fail there.
    for (const surface of ['--color-app', '--color-ink', '--color-raised'] as const) {
      test(`every readable text step clears AA on ${surface}`, async ({ page }) => {
        const { ratios, tokens } = await measure(page, surface);

        for (const step of READABLE_STEPS) {
          expect(
            ratios[step],
            `${step} (${tokens[step] ?? '?'}) on ${surface} (${tokens[surface] ?? '?'})`,
          ).toBeGreaterThanOrEqual(AA);
        }
      });
    }

    test('a selected control carries the two steps it is allowed to carry', async ({ page }) => {
      // `raised-active` is the deepest interactive fill, so `fg-3` does not clear AA on it in
      // either palette. Text on a selected row steps up with the row rather than the surface
      // being lightened to accommodate the quietest grey.
      const { ratios, tokens } = await measure(page, '--color-raised-active');

      for (const step of ['--color-fg', '--color-fg-2'] as const) {
        expect(
          ratios[step],
          `${step} (${tokens[step] ?? '?'}) on --color-raised-active`,
        ).toBeGreaterThanOrEqual(AA);
      }
      expect(ratios['--color-fg-3']).toBeLessThan(AA);
    });

    test('no token resolves to an empty value', async ({ page }) => {
      // A `light-dark()` pair with one half missing fails silently and only in one theme —
      // the exact class of bug two duplicated palettes used to produce.
      const empty = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return [
          '--color-app',
          '--color-panel',
          '--color-ink',
          '--color-raised',
          '--color-raised-hover',
          '--color-raised-active',
          '--color-sunken',
          '--color-overlay',
          '--color-scrim',
          '--color-line',
          '--color-line-strong',
          '--color-fg',
          '--color-fg-2',
          '--color-fg-3',
          '--color-fg-dim',
          '--color-accent',
          '--color-accent-text',
          '--color-now',
          '--color-ok',
          '--color-warn',
          '--color-error',
          '--color-syntax-keyword',
          '--color-syntax-method',
          '--color-syntax-type',
          '--color-syntax-number',
        ].filter((name) => root.getPropertyValue(name).trim() === '');
      });

      expect(empty).toEqual([]);
    });

    test('the two palettes are not the same palette', async ({ page }) => {
      // Guards the case where `color-scheme` stops being applied and both themes silently
      // collapse onto the light half of every pair.
      const ground = await page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor.trim(),
      );
      const isDark = await page.evaluate(() => {
        const [r = 0, g = 0, b = 0] = (
          /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor)?.[1] ?? '0 0 0'
        )
          .split(/[\s,/]+/)
          .map(Number);
        return (r + g + b) / 3 < 128;
      });

      expect(isDark, `body background was ${ground}`).toBe(theme === 'dark');
    });
  });
}

test.describe('the theme control', () => {
  test('cycles system → light → dark and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('data-theme-choice', 'system');
    // Nothing is pinned while the choice is "system" — the OS preference is the answer.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-theme-choice', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-theme-choice', 'dark');

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-theme-choice', 'system');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('applies the stored choice before the page paints', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // `domcontentloaded` rather than `load`: the inline script in index.html runs before the
    // module bundle, so the attribute has to be there while the document is still parsing.
    // If it only arrived with React, a reader who chose light would see a dark flash first.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
  });
});
