#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB_DIR, 'dist');
const ASSETS = join(DIST, 'assets');

const BUDGETS = [
  { chunk: 'index', extension: '.js', gzipKb: 108, why: 'the application itself' },
  { chunk: 'react', extension: '.js', gzipKb: 48, why: 'react + react-dom' },
  { chunk: 'motion', extension: '.js', gzipKb: 50, why: 'framer-motion' },
  { chunk: 'index', extension: '.css', gzipKb: 14, why: 'the whole stylesheet' },
  { chunk: 'run-program.worker', extension: '.js', gzipKb: 16, why: 'parser + interpreter' },
];

// Files copied from public/ verbatim. They are already compressed, so the budget is the file on
// disk; the social card is the one that grows without anyone noticing.
const STATIC_BUDGETS = [
  { file: 'og-image.jpg', kb: 160, why: 'the social card' },
  { file: 'favicon.svg', kb: 4, why: 'the tab icon' },
];

function gzippedKb(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length / 1024;
}

function fileKb(path) {
  return (statSync(path, { throwIfNoEntry: false })?.size ?? Number.NaN) / 1024;
}

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
    const [only] = found;
    if (found.length !== 1 || only === undefined) {
      console.error(
        `✗ ${budget.chunk}${budget.extension}: expected exactly one file, found ${String(found.length)}`,
      );
      failed = true;
      continue;
    }
    const actual = gzippedKb(join(ASSETS, only));
    const over = actual > budget.gzipKb;
    failed ||= over;
    console.log(
      `${over ? '✗' : '✓'} ${`${budget.chunk}${budget.extension}`.padEnd(24)} ` +
        `${actual.toFixed(1).padStart(6)} kB gzip / ${String(budget.gzipKb).padStart(3)} kB  ${budget.why}`,
    );
  }

  for (const budget of STATIC_BUDGETS) {
    const actual = fileKb(join(DIST, budget.file));
    const over = !(actual <= budget.kb);
    failed ||= over;
    console.log(
      `${over ? '✗' : '✓'} ${budget.file.padEnd(24)} ` +
        `${actual.toFixed(1).padStart(6)} kB raw  / ${String(budget.kb).padStart(3)} kB  ${budget.why}`,
    );
  }

  if (failed) {
    console.error(
      '\nSomething is over budget. Find the growth with `npx vite build --mode production ' +
        '&& npx source-map-explorer dist/assets/index-*.js`, or raise the number in ' +
        'web/scripts/check-bundle-size.mjs and say in the commit message what bought it.',
    );
    process.exit(1);
  }
  console.log('\nEvery chunk and static asset is inside its budget.');
}

main();
