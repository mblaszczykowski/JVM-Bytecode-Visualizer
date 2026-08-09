import { expect, test } from '@playwright/test';

test.skip(
  () => process.env.PLAYWRIGHT_COMPILE_API_URL === undefined,
  'needs a compile service: set PLAYWRIGHT_COMPILE_API_URL and VITE_COMPILE_API_URL',
);

const BROKEN_SOURCE = `public class Broken {
    public static void main(String[] args) {
        int result = 1
    }
}
`;

test('writes a class, compiles it and replays the run', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('compiler-health')).toHaveAttribute('data-status', 'online');
  await page.getByRole('button', { name: 'Write Java…', exact: true }).click();

  const editor = page.getByLabel('Java source');
  await expect(editor).toHaveValue(/class FizzBuzz/);

  await page.getByRole('button', { name: 'Compile' }).click();

  await expect(page.getByTestId('step-counter')).toHaveText(/^step 1 \/ \d+$/);
  await expect(page.getByTestId('compile-editor')).toHaveCount(0);

  const source = page.getByRole('region', { name: 'Source' });
  await expect(source).toContainText('FizzBuzz.java');
  await expect(source).toContainText('switch (n % 15)');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-counter')).toHaveText(/^step 2 \/ \d+$/);
  await expect(page.getByTestId('current-instruction')).toContainText('istore_1');

  await page.getByRole('slider', { name: 'Execution history position' }).press('End');
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(page.getByRole('region', { name: 'Locals' })).toContainText('result');
});

test('points at the offending line when the source does not compile', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Write Java…', exact: true }).click();
  await page.getByLabel('Java source').fill(BROKEN_SOURCE);
  await page.getByRole('button', { name: 'Compile' }).click();

  const diagnostic = page.getByTestId('compile-diagnostic').first();
  await expect(diagnostic).toHaveAttribute('data-kind', 'error');
  await expect(diagnostic).toContainText("';' expected");

  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByLabel('Java source')).toHaveValue(BROKEN_SOURCE);
});
