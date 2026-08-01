import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { bundledExamples, fixturePath } from './fixtures';

/**
 * Axe on the three screens a reader actually lands on. Only `serious` and `critical` are
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
  await expect(page.getByTestId('welcome-example')).toHaveCount(bundledExamples().length);

  expect(await seriousViolations(page)).toEqual([]);
});

test('the loaded program has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');

  expect(await seriousViolations(page)).toEqual([]);
});

test('the explorer has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  // A class with no method the interpreter can enter: no run, and every panel still on screen.
  await page.locator('input[type="file"]').first().setInputFiles(fixturePath('Library.class'));
  await expect(page.getByTestId('class-panel')).toBeVisible();

  expect(await seriousViolations(page)).toEqual([]);
});

test('tabbing runs toolbar, then panels, then transport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toBeVisible();

  const stops: string[] = [];
  // Every panel body is a tab stop, each code list adds one more through its roving tabindex,
  // and the left column adds its Source/Class switch, so the walk needs room to reach the
  // transport at the end.
  for (let press = 0; press < 34; press++) {
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
  expect(at('Source'), cycle.join(' → ')).toBeGreaterThan(at('Factorial'));
  expect(at('Bytecode')).toBeGreaterThan(at('Source'));
  expect(at('Call stack')).toBeGreaterThan(at('Bytecode'));
  // Disabled at step 1, but reported with aria-disabled, so it keeps its place in the walk.
  expect(at('Step back')).toBeGreaterThan(at('Call stack'));
  expect(at('Play')).toBeGreaterThan(at('Step back'));
  expect(at('Execution history position')).toBeGreaterThan(at('Play'));
});

test('the speed control announces the value it is set to', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();

  // A bare "Playback speed" label would override the visible `1×` and say nothing.
  await expect(page.getByRole('button', { name: 'Playback speed 1×' })).toBeVisible();
  await page.getByRole('button', { name: 'Playback speed 1×' }).click();
  await expect(page.getByRole('button', { name: 'Playback speed 2×' })).toBeVisible();
});

test('the state panels can be reached and scrolled by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Fibonacci', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toBeVisible();

  for (const name of ['Call stack', 'Operand stack', 'Locals']) {
    const body = page.getByRole('region', { name }).locator('[tabindex="0"]').first();
    await body.focus();
    await expect(body).toBeFocused();
  }
});

test('every panel still follows the step with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('current-instruction')).toContainText('iconst_4');

  await page.getByRole('slider', { name: 'Execution history position' }).fill('26');

  await expect(page.getByTestId('step-counter')).toHaveText('step 27 / 40');
  await expect(page.getByTestId('current-instruction')).toContainText('iload');
  await expect(page.getByTestId('call-frame')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Locals' })).toContainText('n');

  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 26 / 40');
});
