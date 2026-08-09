import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 700 } });

test('shows the embedded run without the chooser', async ({ page }) => {
  await page.goto('/?embed#/bubble-sort/248');

  await expect(page.getByTestId('step-counter')).toHaveText('step 248 / 445');
  await expect(page.getByTestId('embed-bar')).toContainText('BubbleSort.java');

  await expect(page.getByRole('radiogroup', { name: 'Example programs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);

  await expect(page.getByRole('region', { name: 'Bytecode' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operand stack' })).toBeVisible();
  await expect(page.getByTestId('current-instruction')).toContainText('iastore');
});

test('leads out to the same moment in the full application', async ({ page }) => {
  await page.goto('/?embed#/factorial/tour/recursion/3');

  const out = page.getByTestId('embed-open-full');
  await expect(out).toHaveAttribute('target', '_top');
  expect(await out.getAttribute('href')).toContain('#/factorial/tour/recursion/3');
  expect(await out.getAttribute('href')).not.toContain('embed');
});

test('runs something even when the embed names no program', async ({ page }) => {
  await page.goto('/?embed');

  await expect(page.getByTestId('step-counter')).toBeVisible();
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
});

test('keeps the full application untouched without the flag', async ({ page }) => {
  await page.goto('/#/bubble-sort/248');

  await expect(page.getByTestId('embed-bar')).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Example programs' })).toBeVisible();
});

test('fits its frame without pushing the page sideways', async ({ page }) => {
  await page.goto('/?embed#/bubble-sort/248');
  await expect(page.getByTestId('step-counter')).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );

  expect(overflows).toBe(false);
});
