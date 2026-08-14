#!/usr/bin/env node

// Every relative link and image in the committed markdown has to resolve, and every fragment has
// to name a heading that exists. Nothing here touches the network: external URLs are left alone.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// git decides what counts: tracked files plus new ones that are not ignored. That is exactly the
// set a fresh clone would carry, so nothing gitignored is walked and no file has to be named here.
function markdownFiles(directory) {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.md'],
    { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return listed
    .split('\0')
    .filter(Boolean)
    .map((name) => join(directory, name));
}

function withoutCode(markdown) {
  return markdown
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function targetsIn(markdown) {
  const targets = [];
  const inline = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const reference = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+)>?/gm;

  // The rendered diagrams are embedded with <picture>, so their paths sit in HTML attributes
  // rather than in markdown image syntax.
  const htmlImage = /<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*"([^"]*)"/gi;

  for (const pattern of [inline, reference]) {
    for (const match of markdown.matchAll(pattern)) {
      const target = match[1];
      if (target !== undefined) {
        targets.push(target);
      }
    }
  }

  for (const match of markdown.matchAll(htmlImage)) {
    for (const candidate of (match[1] ?? '').split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url !== undefined && url !== '') {
        targets.push(url);
      }
    }
  }
  return targets;
}

function slug(heading) {
  return heading
    .replace(/`/g, '')
    .replace(/\*\*?|__?/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

function anchorsOf(path, cache) {
  const cached = cache.get(path);
  if (cached !== undefined) {
    return cached;
  }

  const anchors = new Set();
  const seen = new Map();
  for (const line of withoutCode(readFileSync(path, 'utf8')).split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) {
      continue;
    }
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${String(count)}`);
  }

  cache.set(path, anchors);
  return anchors;
}

function problemWith(target, file, cache) {
  const [path, fragment] = target.split('#');
  if (path === undefined) {
    return undefined;
  }

  const resolved = path === '' ? file : resolve(dirname(file), path);
  if (!statSync(resolved, { throwIfNoEntry: false })) {
    return `${target} does not exist`;
  }
  if (fragment === undefined || fragment === '' || !resolved.endsWith('.md')) {
    return undefined;
  }
  return anchorsOf(resolved, cache).has(fragment.toLowerCase())
    ? undefined
    : `${target} points at no heading in ${relative(ROOT, resolved)}`;
}

function main() {
  const files = markdownFiles(ROOT).sort();
  const cache = new Map();
  const problems = [];

  for (const file of files) {
    for (const target of targetsIn(withoutCode(readFileSync(file, 'utf8')))) {
      if (EXTERNAL_SCHEME.test(target)) {
        continue;
      }
      const problem = problemWith(target, file, cache);
      if (problem !== undefined) {
        problems.push(`  ${relative(ROOT, file)}: ${problem}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Broken links in the documentation:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`${String(files.length)} markdown files, every relative link and fragment resolves.`);
}

main();
