import { expect, test } from '@playwright/test';

test('strona startowa renderuje nagłówek aplikacji', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'JVM Bytecode Visualizer' })).toBeVisible();
});
