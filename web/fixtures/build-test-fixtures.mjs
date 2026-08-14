#!/usr/bin/env node

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FixtureBuildError,
  JAVA_RELEASE,
  requireExpectedMajorVersion,
  requirePinnedJdk,
  runTool,
} from './jdk.mjs';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(FIXTURES_DIR, '..');

const PINNED_MTIME = new Date('2026-08-05T12:00:00Z');
const ENGLISH_LOCALE = ['-J-Duser.language=en', '-J-Duser.country=US'];

const FIXTURES = Object.freeze([
  {
    className: 'Factorial',
    directory: 'src/core/classfile/__fixtures__',
    javap: 'verbose',
    runs: false,
  },
  {
    className: 'OpcodeZoo',
    directory: 'src/core/disassembler/__fixtures__',
    javap: 'code',
    runs: false,
  },
  {
    className: 'WideOps',
    directory: 'src/core/disassembler/__fixtures__',
    javap: 'code',
    runs: true,
  },
  {
    className: 'Bits',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'Console',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'Exceptions',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'Instances',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'MathOps',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'StackOps',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  {
    className: 'Switches',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
  // Read as bytes by the unit tests of the loading layer: no expected stdout, no javap dump.
  // Counter and Library have no main, and InfiniteLoop never returns from the one it has.
  {
    className: 'Counter',
    directory: 'src/services/__fixtures__',
    javap: undefined,
    runs: false,
  },
  {
    className: 'InfiniteLoop',
    directory: 'src/services/__fixtures__',
    javap: undefined,
    runs: false,
  },
  {
    className: 'Library',
    directory: 'src/services/__fixtures__',
    javap: undefined,
    runs: false,
  },
  // The end-to-end fixtures are loaded through the file input, so only the class file is read:
  // no expected stdout, no javap dump. Counter and Library have no main to run at all.
  {
    className: 'Counter',
    directory: 'tests/e2e/fixtures',
    javap: undefined,
    runs: false,
  },
  {
    className: 'Library',
    directory: 'tests/e2e/fixtures',
    javap: undefined,
    runs: false,
  },
  {
    className: 'UnsupportedInstruction',
    directory: 'tests/e2e/fixtures',
    javap: undefined,
    runs: false,
  },
]);

// Scanned whole rather than one declared directory at a time: a scan driven by FIXTURES cannot
// see a fixture directory that is missing from FIXTURES, which is the case worth catching.
const FIXTURE_ROOTS = Object.freeze(['src', 'tests/e2e/fixtures']);

function sourcePath(fixture) {
  return join(WEB_DIR, fixture.directory, `${fixture.className}.java`);
}

function fixtureDirectories() {
  return [...new Set(FIXTURES.map((fixture) => fixture.directory))];
}

function javaSourcesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return javaSourcesUnder(path);
    }
    return entry.name.endsWith('.java') ? [path] : [];
  });
}

function requireEverySourceDeclared() {
  const declared = new Set(FIXTURES.map((fixture) => sourcePath(fixture)));
  const undeclared = FIXTURE_ROOTS.flatMap((root) => javaSourcesUnder(join(WEB_DIR, root)))
    .filter((path) => !declared.has(path))
    .map((path) => relative(WEB_DIR, path))
    .sort();

  if (undeclared.length > 0) {
    throw new FixtureBuildError(
      `These fixture sources are not declared in build-test-fixtures.mjs, so their class file ` +
        `and expected output are not rebuilt:\n${undeclared.map((path) => `  • ${path}`).join('\n')}\n\n` +
        `Add them to FIXTURES, and add their directory to the drift check in ` +
        '.github/workflows/web.yml.',
    );
  }
}

// One javac run per directory, not one for everything: tests/e2e/fixtures and
// src/services/__fixtures__ both hold a Counter.java and a Library.java, and javac refuses two
// sources declaring the same class.
function compileDirectory(directory, classesDir) {
  runTool('javac', [
    '-g',
    '--release',
    JAVA_RELEASE,
    '-d',
    classesDir,
    ...FIXTURES.filter((fixture) => fixture.directory === directory).map((fixture) =>
      sourcePath(fixture),
    ),
  ]);
}

function headerOf(dumpPath, command) {
  let committed;
  try {
    committed = readFileSync(dumpPath, 'utf8');
  } catch {
    return `# Dump of \`${command}\`, regenerated by fixtures/build-test-fixtures.mjs.\n`;
  }

  const header = [];
  for (const line of committed.split('\n')) {
    if (!line.startsWith('#')) {
      break;
    }
    header.push(line);
  }
  if (header.length === 0) {
    throw new FixtureBuildError(
      `${basename(dumpPath)} has no leading "#" header describing what the dump is for. ` +
        'Add one (see the other dumps), or delete the file and let this script write a stub.',
    );
  }
  return `${header.join('\n')}\n`;
}

function dumpDisassembly(fixture, classesDir) {
  const { className, javap } = fixture;
  const flag = javap === 'verbose' ? '-v' : '-c';
  const dumpPath = join(WEB_DIR, fixture.directory, `${className}.javap.txt`);

  utimesSync(join(classesDir, `${className}.class`), PINNED_MTIME, PINNED_MTIME);
  const raw = runTool('javap', [
    ...ENGLISH_LOCALE,
    flag,
    '-p',
    '-classpath',
    classesDir,
    className,
  ]);
  const normalised = raw.replace(/^Classfile .*$/m, `Classfile ${className}.class`);

  writeFileSync(
    dumpPath,
    `${headerOf(dumpPath, `javap ${flag} -p ${className}.class`)}\n${normalised}`,
    'utf8',
  );
  return `javap ${flag}`;
}

function recordOutput(fixture, classesDir) {
  const stdout = runTool('java', ['-classpath', classesDir, fixture.className]);
  if (stdout === '') {
    throw new FixtureBuildError(
      `${fixture.className} printed nothing, so its .stdout.txt would assert nothing. ` +
        'A runnable fixture has to print every value it computes.',
    );
  }
  writeFileSync(
    join(WEB_DIR, fixture.directory, `${fixture.className}.stdout.txt`),
    stdout,
    'utf8',
  );
  const lines = stdout.split('\n').length - 1;
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

function main() {
  const jdk = requirePinnedJdk();
  requireEverySourceDeclared();

  const classesRoot = mkdtempSync(join(tmpdir(), 'jvm-bytecode-test-fixtures-'));
  try {
    console.log(`javac -g --release ${JAVA_RELEASE} → ${classesRoot}  (${jdk})`);

    const classesDirOf = new Map();
    for (const directory of fixtureDirectories()) {
      const classesDir = join(classesRoot, directory.replaceAll('/', '_'));
      mkdirSync(classesDir, { recursive: true });
      compileDirectory(directory, classesDir);
      classesDirOf.set(directory, classesDir);
    }

    for (const fixture of FIXTURES) {
      const { className } = fixture;
      const classesDir = classesDirOf.get(fixture.directory);
      requireExpectedMajorVersion(classesDir, className);

      const classFile = `${className}.class`;
      copyFileSync(join(classesDir, classFile), join(WEB_DIR, fixture.directory, classFile));

      const produced = [classFile];
      if (fixture.runs) {
        produced.push(`${className}.stdout.txt (${recordOutput(fixture, classesDir)})`);
      }
      if (fixture.javap !== undefined) {
        produced.push(`${className}.javap.txt (${dumpDisassembly(fixture, classesDir)})`);
      }

      console.log(`  ✓ ${fixture.directory}/  ${produced.join(', ')}`);
    }

    console.log(`\nDone: ${FIXTURES.length} fixtures rebuilt from their sources.`);
  } finally {
    rmSync(classesRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (error instanceof FixtureBuildError) {
    console.error(`\nbuild-test-fixtures: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
