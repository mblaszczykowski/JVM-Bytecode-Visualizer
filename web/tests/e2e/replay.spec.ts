import { expect, test, type Page } from '@playwright/test';

/** Factorial(4): 39 executed instructions plus the terminal snapshot. */
const FACTORIAL_STEPS = 40;

/** Rows of both code panels; the current row carries a different test id. */
const SOURCE_ROWS = '[data-testid$="source-line"]';
const BYTECODE_ROWS = '[data-testid$="instruction"]';

async function openFactorial(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(FACTORIAL_STEPS)}`);
}

test('replays a recursive program from the welcome screen to its result', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('welcome-example')).toHaveCount(4);
  await expect(page.getByTestId('step-counter')).toHaveCount(0);

  await page.getByRole('button', { name: 'Factorial', exact: true }).click();

  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(FACTORIAL_STEPS)}`);
  await expect(page.getByTestId('current-instruction')).toContainText('iconst_4');
  await expect(page.getByTestId('current-source-line')).toContainText('int result = factorial(4);');

  // Fast forward: at 1x a forty step run would take half a minute of wall clock.
  const speed = page.getByRole('button', { name: 'Playback speed' });
  for (let click = 0; click < 3; click++) {
    await speed.click();
  }
  await expect(speed).toHaveText('8×');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // The player pauses itself on the last snapshot.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('step-counter')).toHaveText(
    `step ${String(FACTORIAL_STEPS)} / ${String(FACTORIAL_STEPS)}`,
  );

  // The terminal snapshot has no frames; the step before it still holds main's locals.
  await expect(page.getByTestId('call-frame')).toHaveCount(0);
  await page.getByRole('button', { name: 'Step back' }).click();

  const locals = page.getByRole('region', { name: 'Locals' });
  await expect(locals).toContainText('result');
  await expect(locals).toContainText('24');
});

test('scrubbing into the recursion shows the whole call stack', async ({ page }) => {
  await openFactorial(page);

  await page.getByRole('slider', { name: 'Execution history position' }).fill('26');

  await expect(page.getByTestId('step-counter')).toHaveText(`step 27 / ${String(FACTORIAL_STEPS)}`);
  // The list renders bottom-up, so the oldest frame is the last one in the DOM.
  const frames = page.getByTestId('call-frame');
  await expect(frames).toHaveCount(5);
  await expect(frames.last()).toContainText('main');

  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(`step 26 / ${String(FACTORIAL_STEPS)}`);
});

test('the right arrow key advances the step counter', async ({ page }) => {
  await openFactorial(page);

  await page.keyboard.press('ArrowRight');

  await expect(page.getByTestId('step-counter')).toHaveText(`step 2 / ${String(FACTORIAL_STEPS)}`);
  await expect(page.getByTestId('current-instruction')).toContainText('invokestatic');

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(FACTORIAL_STEPS)}`);
});

test('a full pass through the app writes nothing to the console', async ({ page }) => {
  const complaints: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      complaints.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    complaints.push(`pageerror: ${error.message}`);
  });

  await openFactorial(page);
  await page.getByRole('button', { name: 'Step forward' }).click();
  await page.getByRole('button', { name: 'Playback speed' }).click();
  await page.getByRole('slider', { name: 'Execution history position' }).fill('26');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'GCD', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(/^step 1 \/ \d+$/);

  expect(complaints).toEqual([]);
});

test('every code row keeps the 26px rhythm', async ({ page }) => {
  await openFactorial(page);

  for (const rows of [SOURCE_ROWS, BYTECODE_ROWS]) {
    const heights = await page
      .locator(rows)
      .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).offsetHeight));

    expect(heights.length).toBeGreaterThan(3);
    expect(new Set(heights), rows).toEqual(new Set([26]));
  }
});
