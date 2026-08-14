import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

const READABLE_STEPS = ['--color-fg', '--color-fg-2', '--color-fg-3'] as const;

const STYLESHEET = join(dirname(fileURLToPath(import.meta.url)), '../../src/index.css');

function declaredTokens(prefix: string): readonly string[] {
  const pattern = new RegExp(String.raw`^\s*(--${prefix}[a-z0-9-]+):`, 'gm');
  const declared = readFileSync(STYLESHEET, 'utf8').matchAll(pattern);
  return [...new Set([...declared].map((match) => match[1] ?? ''))].sort();
}

const AA = 4.5;

interface Resolved {
  readonly ratios: Record<string, number>;
  readonly tokens: Record<string, string>;
}

async function measure(page: Page, surface: string): Promise<Resolved> {
  return page.evaluate(
    ([surfaceVar, steps]) => {
      const probe = document.createElement('span');
      document.body.append(probe);

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

    test('the two text steps a selected control carries clear AA on it', async ({ page }) => {
      const { ratios, tokens } = await measure(page, '--color-raised-active');

      for (const step of ['--color-fg', '--color-fg-2'] as const) {
        expect(
          ratios[step],
          `${step} (${tokens[step] ?? '?'}) on --color-raised-active`,
        ).toBeGreaterThanOrEqual(AA);
      }
    });

    test('every colour token the stylesheet declares resolves to a value', async ({ page }) => {
      const declared = declaredTokens('color-');
      expect(declared.length).toBeGreaterThan(20);

      const empty = await page.evaluate((names) => {
        const root = getComputedStyle(document.documentElement);
        return names.filter((name) => root.getPropertyValue(name).trim() === '');
      }, declared);

      expect(empty).toEqual([]);
    });

    test('every shadow token the stylesheet declares paints something', async ({ page }) => {
      const declared = [...declaredTokens('shadow-'), '--lift'];
      expect(declared.length).toBeGreaterThan(10);

      const painted = await page.evaluate((names) => {
        const probe = document.createElement('div');
        document.body.append(probe);
        const shadows: Record<string, string> = {};
        for (const name of names) {
          probe.style.boxShadow = '';
          probe.style.boxShadow = `var(${name})`;
          shadows[name] = getComputedStyle(probe).boxShadow;
        }
        probe.remove();
        return shadows;
      }, declared);

      const dropped = declared.filter((name) => painted[name] === 'none');
      expect(dropped, 'a token the box-shadow parser rejected computes to none').toEqual([]);
    });

    test('a panel and an open dialog paint the shadow they were given', async ({ page }) => {
      const panel = page.getByTestId('welcome-example').first();
      await expect(panel).toBeVisible();
      await expect(panel).not.toHaveCSS('box-shadow', 'none');

      await page.getByTestId('toolbar-glossary').click();
      const dialog = page.getByRole('dialog', { name: 'Glossary' });
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toHaveCSS('box-shadow', 'none');
    });

    test('each palette resolves to its own ground colour', async ({ page }) => {
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
  });
});
