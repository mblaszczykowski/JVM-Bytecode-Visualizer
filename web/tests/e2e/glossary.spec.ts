import { expect, test, type Page } from '@playwright/test';

async function openFactorial(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');
}

function panelHelp(page: Page, panel: string) {
  return page.getByRole('region', { name: panel }).getByTestId('glossary-trigger').first();
}

test('explains the panel a reader is looking at, from that panel', async ({ page }) => {
  await openFactorial(page);

  await panelHelp(page, 'Operand stack').click();

  const dialog = page.getByRole('dialog', { name: 'Glossary' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'operand-stack');
  await expect(dialog).toContainText('JVMS §2.6.2');
  await expect(dialog).toContainText('docs/jvm-primer.md');
});

test('reaches the concept behind every panel that draws one', async ({ page }) => {
  await openFactorial(page);

  for (const [panel, term] of [
    ['Call stack', 'call-stack'],
    ['Locals', 'local-variable-slot'],
    ['Bytecode', 'opcode'],
    ['Source', 'line-number-table'],
  ]) {
    await panelHelp(page, panel ?? '').click();
    await expect(page.getByTestId('glossary-entry')).toHaveAttribute('data-term', term ?? '');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
});

test('explains the method descriptor from the notation in the header', async ({ page }) => {
  await openFactorial(page);

  const descriptor = page.getByRole('button', { name: /: What is a descriptor\?$/ });
  await expect(descriptor).toHaveText('([Ljava/lang/String;)V');
  await descriptor.click();

  await expect(page.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'descriptor');
  await expect(page.getByRole('dialog')).toContainText('([Ljava/lang/String;)V');
});

test('traps the focus, escapes to the opener, and leaves the run where it was', async ({
  page,
}) => {
  await openFactorial(page);

  const opener = panelHelp(page, 'Call stack');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Glossary' });
  await expect(dialog).toBeFocused();

  for (let press = 0; press < 10; press++) {
    await page.keyboard.press('Tab');
  }
  await expect(dialog.locator(':focus')).toHaveCount(1);

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('reads across from one term to the next without closing', async ({ page }) => {
  await openFactorial(page);
  await panelHelp(page, 'Operand stack').click();

  const entry = page.getByTestId('glossary-entry');
  await entry.getByRole('button', { name: 'Frame' }).click();
  await expect(entry).toHaveAttribute('data-term', 'frame');

  await page
    .getByRole('navigation', { name: 'Glossary terms' })
    .getByRole('button', { name: 'Constant pool' })
    .click();
  await expect(entry).toHaveAttribute('data-term', 'constant-pool');
  await expect(entry).toContainText('#7');
});

test('offers the glossary from the welcome screen', async ({ page }) => {
  await page.goto('/');

  const pointer = page.getByTestId('welcome-glossary');
  const cards = page.getByTestId('welcome-example');
  await expect(pointer).toBeVisible();

  const viewport = page.viewportSize()?.height ?? 0;
  const lastCard = await cards.last().boundingBox();
  expect(lastCard?.y ?? viewport).toBeLessThan(viewport);

  await pointer.click();
  await expect(page.getByRole('dialog', { name: 'Glossary' })).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is usable when one panel holds the screen', async ({ page }) => {
    await openFactorial(page);

    await page.getByRole('button', { name: 'State', exact: true }).click();
    await panelHelp(page, 'Operand stack').click();

    const dialog = page.getByRole('dialog', { name: 'Glossary' });
    const box = await dialog.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);
    expect(box?.height ?? 0).toBeLessThanOrEqual(844);

    const nav = await page.getByRole('navigation', { name: 'Glossary terms' }).boundingBox();
    expect(nav?.height ?? 0).toBeLessThan(60);
    await expect(page.getByTestId('glossary-entry')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});
