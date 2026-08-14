import { expect, test, type Page } from '@playwright/test';

import { printingExample } from './fixtures';

const COLLATZ = printingExample();

const NAME = COLLATZ.title.split(':')[0]?.trim() ?? '';

const counter = (page: Page) => page.getByTestId('step-counter');
const consoleLines = (page: Page) => page.getByTestId('console-line');

async function stepCount(page: Page): Promise<number> {
  const text = (await counter(page).textContent()) ?? '';
  const total = /\/\s*(\d+)/.exec(text)?.[1];
  if (total === undefined) {
    throw new Error(`could not read the step count from "${text}"`);
  }
  return Number(total);
}

async function seekTo(page: Page, index: number, total: number): Promise<void> {
  await page.getByRole('slider', { name: 'Execution history position' }).fill(String(index));
  await expect(counter(page)).toHaveText(`step ${String(index + 1)} / ${String(total)}`);
}

async function openPrintingExample(page: Page): Promise<number> {
  await page.goto('/');
  await page.getByRole('button', { name: NAME, exact: true }).click();
  await expect(counter(page)).toHaveText(/^step 1 \/ \d+$/);
  return stepCount(page);
}

test('a program that prints gets a console, and it starts out empty', async ({ page }) => {
  await openPrintingExample(page);

  const output = page.getByRole('region', { name: 'Console' });
  await expect(output).toBeVisible();
  await expect(output).toContainText('nothing printed yet');
  await expect(consoleLines(page)).toHaveCount(0);
});

test('the console fills line by line and ends on what java printed', async ({ page }) => {
  const total = await openPrintingExample(page);

  await seekTo(page, Math.floor(total / 2), total);
  const midway = await consoleLines(page).allTextContents();
  expect(midway.length).toBeGreaterThan(0);
  expect(midway.length).toBeLessThan(COLLATZ.expectedOutput.length);
  expect(midway).toEqual(COLLATZ.expectedOutput.slice(0, midway.length));

  await expect(consoleLines(page).last()).toHaveAttribute('aria-current', 'true');

  await seekTo(page, total - 1, total);
  expect(await consoleLines(page).allTextContents()).toEqual([...COLLATZ.expectedOutput]);
  await expect(page.getByRole('region', { name: 'Console' })).toContainText(
    `${String(COLLATZ.expectedOutput.length)} lines`,
  );

  await expect(page.getByTestId('completion-card').getByTestId('result-value')).toHaveText(
    String(COLLATZ.expectedResult),
  );
});

test('a program that prints nothing gets no console', async ({ page }) => {
  const total = await openPrintingExample(page);
  await seekTo(page, total - 1, total);
  await expect(page.getByRole('region', { name: 'Console' })).toBeVisible();

  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(counter(page)).toHaveText('step 1 / 40');

  await expect(page.getByRole('region', { name: 'Console' })).toHaveCount(0);
  await expect(consoleLines(page)).toHaveCount(0);
});
