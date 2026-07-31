import { expect, test, type Page } from '@playwright/test';

import { fixturePath } from './fixtures';

/** The toolbar upload sits first in the DOM; the welcome screen has a drop zone of its own. */
function fileInput(page: Page) {
  return page.locator('input[type="file"]').first();
}

test('a file that is not a class file is rejected, and the app stays usable', async ({ page }) => {
  await page.goto('/');

  await fileInput(page).setInputFiles(fixturePath('not-a-class.txt'));

  const banner = page.getByTestId('error-banner');
  await expect(banner).toHaveAttribute('data-severity', 'error');
  await expect(banner).toContainText('Not a .class file: expected the 0xcafebabe header');

  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();

  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
});

test('an unsupported instruction stops the run but keeps the history playable', async ({
  page,
}) => {
  await page.goto('/');

  await fileInput(page).setInputFiles(fixturePath('UnsupportedInstruction.class'));

  await expect(page.getByTestId('error-banner')).toContainText(
    'Unsupported instruction: i2l (pc 20, method main)',
  );

  // ADR-0001: the snapshots collected before the fault are still a full recording.
  await expect(page.getByTestId('step-counter')).toHaveText(/^step 1 \/ \d+$/);
  await expect(page.getByTestId('current-instruction')).toContainText('iconst_0');

  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(/^step 2 \/ \d+$/);
  await expect(page.getByTestId('current-instruction')).toContainText('istore_1');

  await page.getByRole('slider', { name: 'Execution history position' }).fill('35');
  await expect(page.getByTestId('current-instruction')).toContainText('i2l');
});
