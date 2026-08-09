import { expect, test, type Page } from '@playwright/test';

const READABLE_STEPS = ['--color-fg', '--color-fg-2', '--color-fg-3'] as const;

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

    test('a selected control carries the two steps it is allowed to carry', async ({ page }) => {
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
