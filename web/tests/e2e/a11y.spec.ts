import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Axe on the two screens a reader actually lands on. Only `serious` and `critical` are
 * enforced: the lighter impacts are dominated by contrast readings on translucent glass,
 * where axe has to guess at the composited background.
 */
const ENFORCED_IMPACTS = new Set(['serious', 'critical']);

interface Violation {
  readonly id: string;
  readonly impact: string;
  readonly nodes: readonly string[];
}

async function seriousViolations(page: Page): Promise<Violation[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();

  return results.violations
    .filter((violation) => ENFORCED_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      nodes: violation.nodes.map((node) => node.html),
    }));
}

test('the welcome screen has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-example')).toHaveCount(4);

  expect(await seriousViolations(page)).toEqual([]);
});

test('the loaded program has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');

  expect(await seriousViolations(page)).toEqual([]);
});

test('tabbing runs toolbar, then panels, then transport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toBeVisible();

  const stops: string[] = [];
  for (let press = 0; press < 20; press++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) {
          return 'document';
        }
        // A panel body is a tab stop of its own; report it by the region it scrolls.
        const region = active.closest('[role="region"]')?.getAttribute('aria-label');
        const label = active.getAttribute('aria-label') ?? active.textContent;
        return region ?? label.trim();
      }),
    );
  }

  // The walk starts wherever the click left the focus, so rotate it onto the first control.
  const start = stops.indexOf('Factorial');
  expect(start, stops.join(' → ')).toBeGreaterThanOrEqual(0);
  const cycle = [...stops.slice(start), ...stops.slice(0, start)];

  const at = (label: string): number => cycle.indexOf(label);
  // `Step back` is disabled on the first snapshot, so `Play` is the first transport stop.
  expect(at('Source'), cycle.join(' → ')).toBeGreaterThan(at('Factorial'));
  expect(at('Bytecode')).toBeGreaterThan(at('Source'));
  expect(at('Call stack')).toBeGreaterThan(at('Bytecode'));
  expect(at('Play')).toBeGreaterThan(at('Call stack'));
  expect(at('Execution history position')).toBeGreaterThan(at('Play'));
});

test('every panel still follows the step with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('current-instruction')).toContainText('iconst_4');

  await page.getByRole('slider', { name: 'Execution history position' }).fill('26');

  await expect(page.getByTestId('step-counter')).toHaveText('step 27 / 40');
  await expect(page.getByTestId('current-instruction')).toContainText('iload');
  await expect(page.getByTestId('call-frame')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Locals' })).toContainText('n');

  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 26 / 40');
});
