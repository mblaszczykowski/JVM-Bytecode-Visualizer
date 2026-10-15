import { expect, test } from '@playwright/test';

const compileApiUrl = process.env.PLAYWRIGHT_COMPILE_API_URL ?? '';
const serviceRequired = process.env.COMPILE_SERVICE_REQUIRED === '1';

const BROKEN_SOURCE = `public class Broken {
    public static void main(String[] args) {
        int result = 1
    }
}
`;

test('has a compile service to point at, so a green job cannot mean a skipped file', () => {
  test.skip(!serviceRequired, 'no compile service was promised to this run');

  expect(
    compileApiUrl,
    'COMPILE_SERVICE_REQUIRED is set, so this run has to exercise the compile service, but ' +
      'PLAYWRIGHT_COMPILE_API_URL is empty and every test below it would have skipped. The ' +
      'compile-service job in .github/workflows/e2e.yml sets the three variables together: ' +
      'COMPILE_SERVICE_REQUIRED, PLAYWRIGHT_COMPILE_API_URL and VITE_COMPILE_API_URL.',
  ).not.toBe('');
});

test.describe('against a compile service', () => {
  test.describe.configure({ mode: 'default' });
  test.skip(
    compileApiUrl === '',
    'needs a compile service: set PLAYWRIGHT_COMPILE_API_URL and VITE_COMPILE_API_URL',
  );

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

  test('keeps a large heap array bounded and follows the element being written', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Write Java…', exact: true }).click();
    await page.getByLabel('Java source').fill(`public class LargeArray {
    public static void main(String[] args) {
        int[] values = new int[1000];
        values[999] = 7;
        System.out.println(values[999]);
    }
}`);
    await page.getByRole('button', { name: 'Compile', exact: true }).click();
    await expect(page.getByTestId('step-counter')).toBeVisible();

    await page.getByRole('button', { name: /^Go to pc \d+, iastore$/ }).click();

    await expect(page.getByTestId('heap-cell').last()).toHaveAttribute('data-index', '999');
    expect(await page.getByTestId('heap-cell').count()).toBeLessThanOrEqual(128);
    await page.getByRole('button', { name: 'Previous elements of array @0' }).click();
    await expect(page.getByTestId('heap-cell')).toHaveCount(128);
  });

  test('keeps compiler controls within a narrow phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');
    const write = page.getByRole('button', { name: 'Write Java…', exact: true });
    await expect(write).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(write).toBeInViewport();
    await write.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await expect(page.getByLabel('Java source')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Compile', exact: true })).toBeInViewport();
  });
});
