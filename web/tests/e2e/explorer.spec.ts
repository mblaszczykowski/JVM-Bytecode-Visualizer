import { expect, test, type Page } from '@playwright/test';

import { fixturePath } from './fixtures';

function fileInput(page: Page) {
  return page.locator('input[type="file"]').first();
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await fileInput(page).setInputFiles(fixturePath('Library.class'));
  await expect(page.getByTestId('class-panel')).toBeVisible();
}

test('a class with no entry point opens the explorer instead of bouncing to the welcome screen', async ({
  page,
}) => {
  await openLibrary(page);

  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Bytecode' })).toBeVisible();

  const banner = page.getByTestId('error-banner');
  await expect(banner).toHaveAttribute('data-severity', 'info');
  await expect(banner).toContainText('Library has no method this machine can start from');
  await expect(banner).toContainText('every method listing are on screen to read');

  await expect(page.getByTestId('step-counter')).toHaveCount(0);
});

test('every method is listed, marked as listing only, and can still be read', async ({ page }) => {
  await openLibrary(page);

  const rows = page.getByTestId('method-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('listing only', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Run / })).toHaveCount(0);

  await rows.filter({ hasText: 'clamp' }).getByRole('button').first().click();

  const bytecode = page.getByRole('region', { name: 'Bytecode' });
  await expect(bytecode).toContainText('clamp(III)I');
  await expect(bytecode).toContainText('if_icmpge');
});

test('the constant pool is browsable and cross-linked with the listing', async ({ page }) => {
  await openLibrary(page);

  const poolRow = (index: number) =>
    page.locator(`[data-testid="constant-row"][data-index="${String(index)}"]`);

  await expect(poolRow(1)).toContainText('java/lang/Object.<init>:()V');
  await expect(page.getByRole('region', { name: 'Bytecode' })).toContainText(
    '// Method java/lang/Object.<init>:()V',
  );

  await page.getByRole('button', { name: 'Show constant pool entry #1' }).click();
  await expect(poolRow(1)).toHaveAttribute('aria-current', 'true');

  await poolRow(1).getByRole('button', { name: 'Follow constant pool entry #3' }).click();
  await expect(poolRow(3)).toHaveAttribute('aria-current', 'true');
  await expect(poolRow(3)).toContainText('NameAndType');
  await expect(poolRow(1)).not.toHaveAttribute('aria-current', 'true');
});

test('the class header reads like the opening of a javap dump', async ({ page }) => {
  await openLibrary(page);

  const panel = page.getByTestId('class-panel');
  await expect(panel).toContainText('java/lang/Object');
  await expect(panel).toContainText('public final super');
  await expect(panel).toContainText('class file format of Java 21');
});

test('a class whose entry point is not called main runs from it anyway', async ({ page }) => {
  await page.goto('/');
  await fileInput(page).setInputFiles(fixturePath('Counter.class'));

  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 70');
  await expect(page.getByRole('region', { name: 'Bytecode' })).toContainText('count()I');
  await expect(page.getByTestId('method-row').filter({ hasText: 'count' })).toContainText('entry');

  await page.getByRole('slider', { name: 'Execution history position' }).fill('30');
  await expect(page.getByTestId('step-counter')).toHaveText('step 31 / 70');
  await page.getByRole('button', { name: 'Run count()I' }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 70');
});

test('an example keeps its source, with the class file one tab away', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');

  await expect(page.getByRole('region', { name: 'Source' })).toBeVisible();
  await expect(page.getByTestId('class-panel')).toBeHidden();

  await page.getByRole('button', { name: /^Class: / }).click();

  await expect(page.getByTestId('class-panel')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Source' })).toBeHidden();
  await expect(page.getByTestId('class-panel')).toContainText('Factorial.factorial:(I)I');

  await page.getByRole('button', { name: /^Source: / }).click();
  await expect(page.getByRole('region', { name: 'Source' })).toBeVisible();
});
