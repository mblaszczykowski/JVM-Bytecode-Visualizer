#!/usr/bin/env node

// The script-src directive in vercel.json allows the inline theme script in web/index.html by
// sha256. Editing the script without recomputing the hash leaves the deployed page ignoring the
// stored theme, and nothing else would report it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = join(WEB_DIR, 'index.html');
const VERCEL_JSON = join(WEB_DIR, '..', 'vercel.json');

// A hash covers the script's text content, so the capture stops at the tags on either side.
const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/g;
const SCRIPT_SRC = /(?:^|;)\s*script-src\s([^;]*)/;
const SHA256 = /'(sha256-[A-Za-z0-9+/=]+)'/g;

class CspHashError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CspHashError';
  }
}

/** @returns {never} */
function fail(message) {
  throw new CspHashError(message);
}

function inlineScripts(html) {
  return [...html.matchAll(INLINE_SCRIPT)]
    .map((match) => match[1])
    .filter((body) => body !== undefined)
    .map((body) => ({
      hash: `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`,
      firstLine:
        body
          .split('\n')
          .find((line) => line.trim() !== '')
          ?.trim() ?? '',
    }));
}

function policies(config) {
  return (config.headers ?? [])
    .flatMap((entry) => entry.headers ?? [])
    .filter((header) => header.key.toLowerCase() === 'content-security-policy')
    .map((header) => header.value);
}

function declaredHashes(policy) {
  const scriptSrc = SCRIPT_SRC.exec(policy)?.[1];
  if (scriptSrc === undefined) {
    return undefined;
  }
  return [...scriptSrc.matchAll(SHA256)]
    .map((match) => match[1])
    .filter((hash) => hash !== undefined);
}

function main() {
  const scripts = inlineScripts(readFileSync(INDEX_HTML, 'utf8'));
  const [firstScript] = scripts;
  if (firstScript === undefined) {
    fail(
      'web/index.html has no inline <script>, so the sha256 in the script-src directive of ' +
        'vercel.json allows nothing. Drop the hash from the directive, or restore the script.',
    );
  }

  const found = policies(JSON.parse(readFileSync(VERCEL_JSON, 'utf8')));
  const [policy] = found;
  if (found.length !== 1 || policy === undefined) {
    fail(
      `vercel.json sets ${String(found.length)} Content-Security-Policy headers; this check reads ` +
        'one. Keep a single policy for the document, or teach web/scripts/check-csp-hash.mjs ' +
        'which of them applies to it.',
    );
  }

  const declared = declaredHashes(policy);
  if (declared === undefined) {
    fail(
      'The Content-Security-Policy in vercel.json has no script-src directive, so the inline ' +
        'theme script in web/index.html falls back to default-src. Name script-src explicitly, ' +
        `with the hash of that script: '${firstScript.hash}'.`,
    );
  }

  const computed = scripts.map((script) => script.hash);
  const missing = scripts.filter((script) => !declared.includes(script.hash));
  const stale = declared.filter((hash) => !computed.includes(hash));

  if (missing.length === 0 && stale.length === 0) {
    for (const script of scripts) {
      console.log(`✓ ${script.hash}  ${script.firstLine}`);
    }
    console.log(
      `\nscript-src in vercel.json covers every inline script in web/index.html ` +
        `(${String(scripts.length)}).`,
    );
    return;
  }

  for (const script of missing) {
    console.error(`✗ web/index.html  ${script.hash}  ${script.firstLine}`);
    console.error('    is allowed by no hash in the script-src directive.');
  }
  for (const hash of stale) {
    console.error(`✗ vercel.json     ${hash}`);
    console.error('    matches no inline script in web/index.html.');
  }
  fail(
    'The CSP hash and the script it is meant to allow have drifted apart. Put the ' +
      'web/index.html value into the script-src directive of vercel.json. The hash covers the ' +
      "script's text content exactly, whitespace and all.",
  );
}

try {
  main();
} catch (error) {
  if (error instanceof CspHashError) {
    console.error(`\ncheck-csp-hash: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
