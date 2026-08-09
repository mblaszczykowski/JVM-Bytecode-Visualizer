/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';

function resolveExamplesDir(): string {
  const candidates = [
    resolve(process.cwd(), 'public', 'examples'),
    resolve(process.cwd(), 'web', 'public', 'examples'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'manifest.json')));
  if (found === undefined) {
    throw new Error(`manifest.json not found (looked in: ${candidates.join(', ')}).`);
  }
  return found;
}

const EXAMPLES_DIR = resolveExamplesDir();

export function readExampleBytes(fileName: string): ArrayBuffer {
  const buffer = readFileSync(join(EXAMPLES_DIR, fileName));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function readExampleText(fileName: string): string {
  return readFileSync(join(EXAMPLES_DIR, fileName), 'utf8');
}

export function readExampleManifest(): unknown {
  return JSON.parse(readExampleText('manifest.json'));
}

const FIXTURES_DIR = resolve(
  existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'web'),
  'src',
  'services',
  '__fixtures__',
);

export function readFixtureBytes(fileName: string): ArrayBuffer {
  const buffer = readFileSync(join(FIXTURES_DIR, fileName));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
