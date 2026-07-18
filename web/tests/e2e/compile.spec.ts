/**
 * The editor loop against a real compile service. It needs a backend, so the default run
 * skips this file and the rest of the suite stays green without one:
 *
 *   VITE_COMPILE_API_URL=http://localhost:8080 \
 *   PLAYWRIGHT_COMPILE_API_URL=http://localhost:8080 npm run e2e -w web
 *
 * The first variable is baked into the bundle by the build Playwright runs, the second one
 * switches these tests on. A preview server left over from an earlier run serves the old
 * bundle — stop it before starting.
 */
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
  await page.getByRole('button', { name: 'Write Java…' }).click();

  const editor = page.getByLabel('Java source');
  await expect(editor).toHaveValue(/class Loop/);

  await page.getByRole('button', { name: 'Compile' }).click();

  await expect(page.getByTestId('step-counter')).toHaveText(/^step 1 \/ \d+$/);
  await expect(page.getByTestId('compile-editor')).toHaveCount(0);

  // The source panel shows the .java that was compiled, not a placeholder.
  const source = page.getByRole('region', { name: 'Source' });
  await expect(source).toContainText('Loop.java');
  await expect(source).toContainText('static int sumTo(int n)');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-counter')).toHaveText(/^step 2 \/ \d+$/);
  await expect(page.getByTestId('current-instruction')).toContainText('invokestatic');

  await page.getByRole('slider', { name: 'Execution history position' }).press('End');
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect(page.getByRole('region', { name: 'Locals' })).toContainText('result');
});

test('points at the offending line when the source does not compile', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Write Java…' }).click();
  await page.getByLabel('Java source').fill(BROKEN_SOURCE);
  await page.getByRole('button', { name: 'Compile' }).click();

  const diagnostic = page.getByTestId('compile-diagnostic').first();
  await expect(diagnostic).toHaveAttribute('data-kind', 'error');
  await expect(diagnostic).toContainText("';' expected");

  // A compile error is not a broken application: the editor keeps the source as written.
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByLabel('Java source')).toHaveValue(BROKEN_SOURCE);
});
