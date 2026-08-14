// Fails when src/ grows an import cycle. A cycle is legal TypeScript and legal at run time
// until the day one of the modules reads the other's binding during evaluation, at which point
// it is a TDZ crash in a build nobody changed. Cheaper to refuse the cycle.
//
// This reads text rather than the TypeScript AST, so an `import type` edge counts like any other.
// A type-level loop is erased at compile time, so refusing one is a false positive. Telling the
// two apart would mean running the compiler here; breaking the edge instead is cheaper.
//
// Run by `npm run imports -w web`, and by the web workflow.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(WEB, 'src');

const SOURCE = /\.tsx?$/;

// `from './x'`, `import('./x')` and the bare side-effect form `import './x'`. A self-registering
// module is pulled in with the last one, and a loop through it is the crash this script refuses.
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]*)['"]/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE.test(name) ? [path] : [];
  });
}

// A specifier carries no extension, so try the ways TypeScript would resolve it.
function resolveImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function buildGraph(files) {
  const graph = new Map();
  for (const file of files) {
    const targets = new Set();
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const target = resolveImport(file, specifier);
      if (target !== undefined && target !== file) {
        targets.add(target);
      }
    }
    graph.set(file, targets);
  }
  return graph;
}

function findCycles(graph) {
  const cycles = [];
  const settled = new Set();
  const path = [];

  function visit(node) {
    const at = path.indexOf(node);
    if (at !== -1) {
      cycles.push([...path.slice(at), node]);
      return;
    }
    if (settled.has(node)) {
      return;
    }
    path.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      visit(next);
    }
    path.pop();
    settled.add(node);
  }

  for (const node of [...graph.keys()].sort()) {
    visit(node);
  }
  return cycles;
}

const files = sourceFiles(SRC);
const cycles = findCycles(buildGraph(files));

if (cycles.length > 0) {
  for (const cycle of cycles) {
    console.error(
      `import cycle: ${cycle.map((file) => relative(WEB, file)).join('\n           -> ')}`,
    );
  }
  console.error(
    `\n${String(cycles.length)} import cycle(s). Break one edge and the module graph is a DAG again.`,
  );
  process.exit(1);
}

console.log(`No import cycles among ${String(files.length)} modules under src/.`);
