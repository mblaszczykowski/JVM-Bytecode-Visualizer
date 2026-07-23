import { expect, test, type Page } from '@playwright/test';

/** Factorial(4): 39 executed instructions plus the terminal snapshot. */
const FACTORIAL_STEPS = 40;

/** Rows of both code panels; the current row carries a different test id. */
const SOURCE_ROWS = '[data-testid$="source-line"]';
const BYTECODE_ROWS = '[data-testid$="instruction"]';

async function openFactorial(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(FACTORIAL_STEPS)}`);
}

test('replays a recursive program from the welcome screen to its result', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('welcome-example')).toHaveCount(4);
  await expect(page.getByTestId('step-counter')).toHaveCount(0);

  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();

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

  // The last snapshot is the payoff, not three empty panels: the value the program
  // computed, the length of the run and how deep it went.
  await expect(page.getByTestId('call-frame')).toHaveCount(0);
  const completion = page.getByTestId('completion-card');
  await expect(completion).toContainText('result');
  await expect(completion).toContainText('24');
  await expect(completion).toContainText('5 frames');
  await expect(completion).toContainText(String(FACTORIAL_STEPS));

  // The frame that produced it is still described rather than blanked with the stack.
  const locals = page.getByRole('region', { name: 'Locals' });
  await expect(locals).toContainText('result');
  await expect(locals).toContainText('24');
});

test('clicking an instruction row seeks to the first step that reached it', async ({ page }) => {
  await openFactorial(page);
  // The listing follows the top frame, so the recursive method has to be on screen first.
  await page.getByRole('slider', { name: 'Execution history position' }).fill('20');

  await page.getByRole('button', { name: 'Go to pc 11, invokestatic' }).click();

  await expect(page.getByTestId('step-counter')).toHaveText(`step 10 / ${String(FACTORIAL_STEPS)}`);
  await expect(page.getByTestId('current-instruction')).toContainText('invokestatic');

  // And the same from the source side, by keyboard.
  const line = page.getByRole('button', { name: 'Go to line 27' });
  await line.focus();
  await line.press('Enter');
  await expect(page.getByTestId('current-source-line')).toContainText('return 1;');
});

test('a file dropped outside the zone never navigates the tab away', async ({ page }) => {
  await openFactorial(page);

  const navigated = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0, 1])], 'Stray.class'));
    const event = new DragEvent('dragover', {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    // An unprevented dragover is the browser keeping the drop for itself.
    return !event.defaultPrevented;
  });

  expect(navigated).toBe(false);
  await expect(page.getByTestId('step-counter')).toBeVisible();
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
  // The click left the focus on the example picker, and a radio group owns the arrow keys
  // while it has the focus. Dropping the focus hands them back to the transport.
  await page.getByRole('heading', { level: 1 }).click();

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
  await page.getByRole('radio', { name: 'GCD', exact: true }).click();
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
