#!/usr/bin/env node
/**
 * Fails the build when a shipped chunk outgrows its budget.
 *
 * ADR-0006 measured what this application costs a browser and changed the architecture on the
 * strength of it. Nothing enforced any of that afterwards: a bundle grows a hundred kilobytes
 * one dependency at a time, and every individual step looks reasonable in review. A number in
 * a file is what makes the hundredth kilobyte someone's decision instead of an accident.
 *
 * Budgets are on the **gzipped** size, because that is what crosses the network, and they are
 * set close to the current figure — a budget with room to spare is a budget that never fires.
 * Raising one is a normal thing to do; doing it in a commit that says why is the point.
 *
 * Usage: `npm run size -w web` (after a build; CI runs the build first).
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(WEB_DIR, 'dist', 'assets');

/**
 * One budget per chunk the build emits, matched on the name Vite gives it before the content
 * hash. `manualChunks` in vite.config.ts is what makes these separable in the first place.
 */
const BUDGETS = [
  { chunk: 'index', extension: '.js', gzipKb: 95, why: 'the application itself' },
  { chunk: 'react', extension: '.js', gzipKb: 48, why: 'react + react-dom' },
  { chunk: 'motion', extension: '.js', gzipKb: 50, why: 'framer-motion' },
  { chunk: 'index', extension: '.css', gzipKb: 14, why: 'the whole stylesheet' },
  { chunk: 'run-program.worker', extension: '.js', gzipKb: 16, why: 'parser + interpreter' },
];

function gzippedKb(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length / 1024;
}

/** `index-CNFrRZNK.js` belongs to the `index` chunk; the hash changes on every build. */
function matches(fileName, { chunk, extension }) {
  return fileName.startsWith(`${chunk}-`) && fileName.endsWith(extension);
}

function main() {
  if (!statSync(ASSETS, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`No build to measure at ${ASSETS}. Run \`npm run build -w web\` first.`);
    process.exit(1);
  }
  const files = readdirSync(ASSETS);

  let failed = false;
  for (const budget of BUDGETS) {
    const found = files.filter((file) => matches(file, budget));
    if (found.length !== 1) {
      // A chunk that vanished or split in two is a change to the shipped shape, and silently
      // measuring nothing is the one outcome this script must not have.
      console.error(
        `✗ ${budget.chunk}${budget.extension}: expected exactly one file, found ${String(found.length)}`,
      );
      failed = true;
      continue;
    }
    const actual = gzippedKb(join(ASSETS, found[0]));
    const over = actual > budget.gzipKb;
    failed ||= over;
    console.log(
      `${over ? '✗' : '✓'} ${`${budget.chunk}${budget.extension}`.padEnd(24)} ` +
        `${actual.toFixed(1).padStart(6)} kB gzip / ${String(budget.gzipKb).padStart(3)} kB  ${budget.why}`,
    );
  }

  if (failed) {
    console.error(
      '\nA chunk is over budget. Either find the growth — `npx vite build --mode production ' +
        '&& npx source-map-explorer dist/assets/index-*.js` — or raise the number in ' +
        'web/scripts/check-bundle-size.mjs and say in the commit message what bought it.',
    );
    process.exit(1);
  }
  console.log('\nEvery chunk is inside its budget.');
}

main();
