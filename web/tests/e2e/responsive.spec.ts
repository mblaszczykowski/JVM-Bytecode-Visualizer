import { expect, test, type Locator, type Page } from '@playwright/test';

const FACTORIAL_STEPS = 40;

/** Smallest tap target the transport is allowed to offer where there is no pointer. */
const MIN_TAP_TARGET = 44;

async function openFactorial(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Factorial', exact: true }).click();
  await expect(page.getByTestId('step-counter')).toHaveText(`step 1 / ${String(FACTORIAL_STEPS)}`);
}

async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('element is not laid out');
  }
  return box.width;
}

test.describe('tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('runs a program with the State column folded into a band below the code', async ({
    page,
  }) => {
    await openFactorial(page);

    // All three panels are on screen; nothing is behind a tab.
    await expect(page.getByTestId('panel-switch')).toBeHidden();
    const source = page.getByRole('region', { name: 'Source' });
    const bytecode = page.getByRole('region', { name: 'Bytecode' });
    const state = page.getByTestId('state-column');
    await expect(source).toBeVisible();
    await expect(bytecode).toBeVisible();
    await expect(state).toBeVisible();

    // Source and Bytecode share a row; the State band spans the pair underneath them.
    const sourceBox = (await source.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const bytecodeBox = (await bytecode.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const stateBox = (await state.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(bytecodeBox.x).toBeGreaterThan(sourceBox.x);
    expect(sourceBox.y).toBeCloseTo(bytecodeBox.y, 0);
    expect(stateBox.y).toBeGreaterThan(sourceBox.y + sourceBox.height - 1);
    expect(stateBox.width).toBeGreaterThan(sourceBox.width + bytecodeBox.width - 1);

    // The three state sections sit side by side inside the band.
    const frames = state.getByRole('region', { name: 'Call stack' });
    const operands = state.getByRole('region', { name: 'Operand stack' });
    const locals = state.getByRole('region', { name: 'Locals' });
    const [framesBox, operandsBox, localsBox] = await Promise.all([
      frames.boundingBox(),
      operands.boundingBox(),
      locals.boundingBox(),
    ]);
    expect(framesBox?.x).toBeLessThan(operandsBox?.x ?? 0);
    expect(operandsBox?.x).toBeLessThan(localsBox?.x ?? 0);

    // The happy path itself: play through to the end of the recording.
    const speed = page.getByRole('button', { name: 'Playback speed' });
    for (let click = 0; click < 3; click++) {
      await speed.click();
    }
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('step-counter')).toHaveText(
      `step ${String(FACTORIAL_STEPS)} / ${String(FACTORIAL_STEPS)}`,
    );
  });
});

test.describe('laptop', () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test('narrows the State column to 280px and keeps the three columns', async ({ page }) => {
    await openFactorial(page);

    expect(await widthOf(page.getByTestId('state-column'))).toBeCloseTo(280, 0);
    const source = await page.getByRole('region', { name: 'Source' }).boundingBox();
    const state = await page.getByTestId('state-column').boundingBox();
    expect(state?.y).toBeCloseTo(source?.y ?? 0, 0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows one panel at a time and keeps the transport within reach', async ({ page }) => {
    await openFactorial(page);

    // Full bleed: the glass gives up its margin and its corners.
    const shell = page.getByTestId('app-shell');
    await expect(shell).toHaveCSS('border-top-left-radius', '0px');
    expect(await widthOf(shell)).toBe(390);

    const source = page.getByRole('region', { name: 'Source' });
    const bytecode = page.getByRole('region', { name: 'Bytecode' });
    const state = page.getByTestId('state-column');

    await expect(bytecode).toBeVisible();
    await expect(source).toBeHidden();
    await expect(state).toBeHidden();

    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(source).toBeVisible();
    await expect(bytecode).toBeHidden();
    await expect(page.getByTestId('current-source-line')).toBeVisible();

    await page.getByRole('button', { name: 'State', exact: true }).click();
    await expect(state).toBeVisible();
    await expect(source).toBeHidden();

    // Transport pinned to the bottom edge, with targets a thumb can hit.
    for (const name of ['Step back', 'Play', 'Step forward']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
      expect(box?.width, name).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    const scrubber = await page
      .getByRole('slider', { name: 'Execution history position' })
      .boundingBox();
    expect(scrubber?.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);

    const counter = await page.getByTestId('step-counter').boundingBox();
    expect(counter?.y).toBeLessThan(844);
  });
});
