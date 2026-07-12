import { expect, test } from '@playwright/test';

test('the start page renders the application shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'JVM Bytecode Visualizer' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bytecode' })).toBeVisible();
  await expect(page.getByTestId('current-instruction')).toBeVisible();
});

test('every code row keeps the 26px rhythm', async ({ page }) => {
  await page.goto('/');

  const heights = await page
    .getByTestId('source-line')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).offsetHeight));

  expect(new Set(heights)).toEqual(new Set([26]));
});
