#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORPUS_DIR = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(CORPUS_DIR, '.cache');
const JARS_DIR = join(CACHE_DIR, 'jars');
export const CLASSES_DIR = join(CACHE_DIR, 'classes');

const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';

const CORPUS = [
  {
    path: 'com/google/guava/guava/33.4.0-jre/guava-33.4.0-jre.jar',
    sha1: '03fcc0a259f724c7de54a6a55ea7e26d3d5c0cac',
    why: 'the largest ordinary Java library anyone depends on',
  },
  {
    path: 'com/google/code/gson/gson/2.11.0/gson-2.11.0.jar',
    sha1: '527175ca6d81050b53bdd4c457a6d6e017626b0e',
    why: 'reflection-heavy, ships a module-info',
  },
  {
    path: 'org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar',
    sha1: 'b17d2136f0460dcc0d2016ceefca8723bdf4ee70',
    why: 'a multi-release jar',
  },
  {
    path: 'com/fasterxml/jackson/core/jackson-databind/2.18.2/jackson-databind-2.18.2.jar',
    sha1: 'deef8697b92141fb6caf7aa86966cff4eec9b04f',
    why: 'deep inheritance and very large switch tables',
  },
  {
    path: 'org/slf4j/slf4j-api/2.0.16/slf4j-api-2.0.16.jar',
    sha1: '0172931663a09a1fa515567af5fbef00897d3c04',
    why: 'small, interface-dominated',
  },
  {
    path: 'org/junit/jupiter/junit-jupiter-api/5.11.4/junit-jupiter-api-5.11.4.jar',
    sha1: '308315b28e667db4091b2ba1f7aa220d1ddadb97',
    why: 'modern javac, annotations everywhere, records',
  },
  {
    path: 'org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.jar',
    sha1: '85f8b81009cda5890e54ba67d64b5e599c645020',
    why: 'kotlinc, with its own attributes and synthetic shapes',
  },
  {
    path: 'org/scala-lang/scala-library/2.13.15/scala-library-2.13.15.jar',
    sha1: 'ed6f1d58968b16c5f9067d5cac032d952552de58',
    why: 'scalac, which emits the densest constant pools of the set',
  },
  {
    path: 'org/ow2/asm/asm/9.7.1/asm-9.7.1.jar',
    sha1: 'f0ed132a49244b042cd0e15702ab9f2ce3cc8436',
    why: 'a bytecode library, so its own test of the format is thorough',
  },
  {
    path: 'org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar',
    sha1: '62ebe7544cb7164d87e0637a2a6a2bdc981395e8',
    why: 'a Signature attribute on 97% of its classes, the highest in the set',
  },
];

function sha1Of(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

async function download(entry) {
  const url = `${MAVEN_CENTRAL}/${entry.path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  const actual = sha1Of(bytes);
  if (actual !== entry.sha1) {
    throw new Error(`${entry.path}: expected sha1 ${entry.sha1}, got ${actual}`);
  }
  return bytes;
}

function unpack(jarPath, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  execFileSync('unzip', ['-qq', '-o', jarPath, '*.class', '-d', into], { stdio: 'pipe' });
}

function isUnpacked(directory) {
  if (!existsSync(directory)) {
    return false;
  }
  return readdirSync(directory, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && entry.name.endsWith('.class'),
  );
}

async function main() {
  mkdirSync(JARS_DIR, { recursive: true });
  mkdirSync(CLASSES_DIR, { recursive: true });

  for (const entry of CORPUS) {
    const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const jarPath = join(JARS_DIR, name);
    const into = join(CLASSES_DIR, name.replace(/\.jar$/, ''));

    if (existsSync(jarPath) && sha1Of(readFileSync(jarPath)) === entry.sha1 && isUnpacked(into)) {
      console.log(`  = ${name} (cached)`);
      continue;
    }

    process.stdout.write(`  ↓ ${name} …`);
    writeFileSync(jarPath, await download(entry));
    unpack(jarPath, into);
    console.log(' ok');
  }

  writeFileSync(
    join(CACHE_DIR, 'corpus.json'),
    `${JSON.stringify({ jars: CORPUS.map(({ path, sha1, why }) => ({ path, sha1, why })) }, null, 2)}\n`,
  );
  console.log(`\nCorpus ready in ${CLASSES_DIR}`);
  console.log('Run the scan with: npm run test:corpus -w web');
}

await main();
