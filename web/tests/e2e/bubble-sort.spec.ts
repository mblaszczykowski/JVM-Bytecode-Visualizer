import { expect, test, type Page } from '@playwright/test';

const STEPS = 445;

const FIRST_SWAP_STORE = 62;

const UNSORTED = ['5', '3', '4', '1', '2'];
const SORTED = ['1', '2', '3', '4', '5'];

async function openBubbleSort(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Bubble sort', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(STEPS)}`);
}

async function seekTo(page: Page, index: number): Promise<void> {
  await page.getByRole('slider', { name: 'Execution history position' }).fill(String(index));
  await expect(page.getByTestId('step-counter')).toHaveText(
    `step ${String(index + 1)} / ${String(STEPS)}`,
  );
}

test('shows the array on the heap and the element each instruction touches', async ({ page }) => {
  await openBubbleSort(page);
  await seekTo(page, FIRST_SWAP_STORE);

  const heap = page.getByRole('region', { name: 'Heap' });
  await expect(heap.getByTestId('heap-array')).toHaveCount(1);
  await expect(heap).toContainText('int[5]@0');
  await expect(page.getByTestId('heap-cell')).toHaveText(UNSORTED);

  await expect(heap).toContainText('writes index 0');
  await expect(page.getByTestId('heap-cell').first()).toHaveAttribute('data-current', 'true');
});

test('stepping through a swap changes the array on screen', async ({ page }) => {
  await openBubbleSort(page);
  await seekTo(page, FIRST_SWAP_STORE);

  await page.getByRole('button', { name: 'Step forward' }).click();

  await expect(page.getByTestId('step-counter')).toHaveText(
    `step ${String(FIRST_SWAP_STORE + 2)} / ${String(STEPS)}`,
  );
  await expect(page.getByTestId('heap-cell')).toHaveText(['3', '3', '4', '1', '2']);
});

test('shows a reference as the array it points at', async ({ page }) => {
  await openBubbleSort(page);
  await seekTo(page, FIRST_SWAP_STORE);

  const operands = page.getByRole('region', { name: 'Operand stack' });
  await expect(operands.getByTestId('ref-chip')).toHaveText(['int[5]@0']);

  const locals = page.getByRole('region', { name: 'Locals' });
  await expect(locals).toContainText('int[]');
  await expect(locals.getByTestId('ref-chip')).toHaveText(['int[5]@0']);
});

test('ends on the sorted array as well as the result', async ({ page }) => {
  await openBubbleSort(page);
  await seekTo(page, STEPS - 1);

  const completion = page.getByTestId('completion-card');
  await expect(completion.getByTestId('result-value')).toHaveText('1');
  await expect(completion.getByTestId('heap-cell')).toHaveText(SORTED);
  await expect(page.getByTestId('call-frame')).toHaveCount(0);
});

test('shows no heap for an int-only program', async ({ page }) => {
  await openBubbleSort(page);
  await expect(page.getByTestId('heap-array')).toHaveCount(0);
  await seekTo(page, FIRST_SWAP_STORE);
  await expect(page.getByTestId('heap-array')).toHaveCount(1);

  await page.getByRole('radio', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText('step 1 / 40');

  await expect(page.getByRole('region', { name: 'Heap' })).toHaveCount(0);
  await expect(page.getByTestId('heap-cell')).toHaveCount(0);
});
