#!/usr/bin/env node

// Renders every docs/diagrams/*.mmd to a light and a dark SVG beside it. mermaid runs inside the
// Chromium that Playwright already installs for the end-to-end suite, so there is no second
// browser to download. The output is byte-stable, and the docs workflow re-renders it and fails
// on any difference, so a diagram edited without regenerating it does not merge.

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGRAM_DIR = resolve(WEB_DIR, '..', 'docs', 'diagrams');

// The UMD build is one self-contained file, so it can be injected into a blank page. The ESM build
// code-splits and would need a server to resolve its chunks.
const MERMAID_BUNDLE = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');

// Every box is sized from measured text, so the font decides the geometry. Arial ships with macOS
// and Windows and fontconfig maps it to the metrically identical Liberation Sans on Linux, which
// keeps a local render and a CI render byte-identical.
const FONT_STACK = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

const THEMES = [
  { suffix: 'light', theme: 'default' },
  { suffix: 'dark', theme: 'dark' },
];

/**
 * @typedef {{ name: string; description: string; source: string }} Diagram
 * @typedef {{
 *   initialize: (config: Record<string, unknown>) => void;
 *   render: (id: string, source: string) => Promise<{ svg: string }>;
 * }} Mermaid
 */

/** @returns {readonly Diagram[]} */
function readDiagrams() {
  const names = readdirSync(DIAGRAM_DIR)
    .filter((entry) => entry.endsWith('.mmd'))
    .sort();
  if (names.length === 0) throw new Error(`no .mmd sources in ${DIAGRAM_DIR}`);

  return names.map((file) => {
    const source = readFileSync(join(DIAGRAM_DIR, file), 'utf8');
    const first = source.split('\n', 1)[0] ?? '';
    if (!first.startsWith('%% ')) {
      throw new Error(`${file} must open with a "%% " line describing what the diagram shows`);
    }
    return { name: file.slice(0, -'.mmd'.length), description: first.slice(3).trim(), source };
  });
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// These files are read as standalone images, so the description belongs inside them rather than
// only in the alt text of whichever document embeds them.
function withTitle(svg, description) {
  const openingTag = /^<svg\b[^>]*>/.exec(svg);
  if (openingTag === null) throw new Error('mermaid returned something that is not an <svg>');
  const end = openingTag[0].length;
  return `${svg.slice(0, end)}<title>${escapeXml(description)}</title>${svg.slice(end)}\n`;
}

async function render(browser, diagram, { suffix, theme }) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: MERMAID_BUNDLE });
    const svg = await page.evaluate(
      async ({ id, source, mermaidTheme, fontFamily }) => {
        const { mermaid } = /** @type {{ mermaid: Mermaid }} */ (
          /** @type {unknown} */ (globalThis)
        );
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          logLevel: 'error',
          // Without these two, every element id carries a timestamp and no two runs agree.
          deterministicIds: true,
          deterministicIDSeed: id,
          theme: mermaidTheme,
          fontFamily,
          themeVariables: { fontFamily },
          // HTML labels would put <br> inside a <foreignObject>, which is not well-formed XML and
          // fails to parse when the browser loads the file as an image rather than as markup.
          htmlLabels: false,
          flowchart: { htmlLabels: false, useMaxWidth: false },
          // useMaxWidth would emit width="100%", leaving the image with no intrinsic size.
          sequence: { useMaxWidth: false },
        });
        const { svg: rendered } = await mermaid.render(id, source);
        return rendered;
      },
      {
        id: diagram.name,
        source: diagram.source,
        mermaidTheme: theme,
        fontFamily: FONT_STACK,
      },
    );

    if (/aria-roledescription="error"|Syntax error in text/.test(svg)) {
      throw new Error(`${diagram.name} did not parse`);
    }

    const file = `${diagram.name}-${suffix}.svg`;
    writeFileSync(join(DIAGRAM_DIR, file), withTitle(svg, diagram.description));
    return file;
  } finally {
    await page.close();
  }
}

// A renamed or deleted source would otherwise leave its images behind, and the drift check in CI
// only ever looks at what this script writes.
function removeOrphans(diagrams) {
  const expected = new Set(
    diagrams.flatMap((diagram) => THEMES.map(({ suffix }) => `${diagram.name}-${suffix}.svg`)),
  );
  for (const file of readdirSync(DIAGRAM_DIR)) {
    if (file.endsWith('.svg') && !expected.has(file)) {
      rmSync(join(DIAGRAM_DIR, file));
      console.log(`  removed ${file}, which has no source`);
    }
  }
}

async function main() {
  const diagrams = readDiagrams();
  removeOrphans(diagrams);
  const browser = await chromium.launch();
  let written = 0;

  try {
    for (const diagram of diagrams) {
      for (const theme of THEMES) {
        // A fresh page per render, so the id counter and the theme of one diagram cannot reach
        // the next one.
        const file = await render(browser, diagram, theme);
        console.log(`  ${file}`);
        written += 1;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nwrote ${String(written)} diagrams to docs/diagrams/`);
}

await main();
