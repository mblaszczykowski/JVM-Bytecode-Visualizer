#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(WEB_DIR, '..', 'docs', 'screenshots');
const PORT = 4319;
const BASE_URL = `http://localhost:${String(PORT)}`;

const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;

/**
 * @typedef {import('@playwright/test').Page} Page
 * @typedef {{ file: string; theme: 'dark' | 'light'; go: (page: Page) => Promise<void> }} Shot
 */

/** @type {readonly Shot[]} */
const SHOTS = [
  {
    file: 'welcome.png',
    theme: 'dark',
    async go(page) {
      await page.goto(`${BASE_URL}/`);
      await page.getByTestId('welcome-example').first().waitFor();
      await expect(
        page.locator(
          '[data-testid="welcome-example"]:not(:has([data-testid="welcome-sparkline-bar"]))',
        ),
      ).toHaveCount(0);
    },
  },
  {
    file: 'app-ready.png',
    theme: 'dark',
    async go(page) {
      await page.goto(`${BASE_URL}/#/factorial/19`);
      await expectStep(page, 'step 19 / 40');
    },
  },
  {
    file: 'bubble-sort.png',
    theme: 'dark',
    async go(page) {
      await page.goto(`${BASE_URL}/#/bubble-sort/63`);
      await expectStep(page, 'step 63 / 445');
    },
  },
  {
    file: 'console.png',
    theme: 'dark',
    async go(page) {
      await page.goto(`${BASE_URL}/#/collatz/200`);
      await expectStep(page, 'step 200 / 294');
    },
  },
  {
    file: 'light-theme.png',
    theme: 'light',
    async go(page) {
      await page.goto(`${BASE_URL}/#/factorial/19`);
      await expectStep(page, 'step 19 / 40');
    },
  },
  {
    file: 'error-banner.png',
    theme: 'dark',
    async go(page) {
      await page.goto(`${BASE_URL}/`);
      const unsupported = join(WEB_DIR, 'tests', 'e2e', 'fixtures', 'UnsupportedInstruction.class');
      await page.locator('input[type="file"]').first().setInputFiles(unsupported);
      await page.getByTestId('error-banner').waitFor();
      await page.getByTestId('step-counter').waitFor();
    },
  },
];

async function expectStep(page, text) {
  await page.getByTestId('step-counter').filter({ hasText: text }).waitFor({ timeout: 15_000 });
}

/** @returns {Promise<void>} */
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${String(code)}`)),
    );
  });
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(url).catch(() => undefined);
    if (response?.ok) return;
    if (Date.now() > deadline) throw new Error(`server did not come up at ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('building…');
  await run('npm', ['run', 'build'], { cwd: WEB_DIR });

  console.log(`serving dist/ on ${BASE_URL}`);
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: WEB_DIR,
    stdio: 'ignore',
    detached: true,
  });

  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch();
    try {
      for (const shot of SHOTS) {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: SCALE,
          colorScheme: shot.theme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await shot.go(page);
        await page.evaluate('document.fonts.ready');
        await page.waitForTimeout(600);
        const path = join(OUTPUT_DIR, shot.file);
        await page.screenshot({ path });
        console.log(`  ${shot.file} (${shot.theme})`);
        await context.close();
      }

      const social = await browser.newContext({
        viewport: { width: 1200, height: 750 },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      });
      try {
        const page = await social.newPage();
        await page.goto(`${BASE_URL}/#/factorial/19`);
        await expectStep(page, 'step 19 / 40');
        await page.evaluate('document.fonts.ready');
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(WEB_DIR, 'public', 'og-image.jpg'), quality: 85 });
        console.log('  og-image.jpg (dark, 1200×750)');
      } finally {
        await social.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server.pid !== undefined) {
      try {
        process.kill(-server.pid);
      } catch {
        server.kill();
      }
    }
  }

  console.log(`\nwrote ${String(SHOTS.length)} screenshots to docs/screenshots/`);
}

await main();
