#!/usr/bin/env node
/**
 * Rebuilds the fixtures the `src/core` tests assert against: the class files under
 * `__fixtures__/`, the `javap` dumps the disassembler and parser are compared with, and the
 * `.stdout.txt` files that are the differential suite's expectations.
 *
 * Those expectations are only worth anything because a real JDK produced them. Editing one of
 * the `.java` sources without recompiling would leave a test asserting against output that no
 * longer belongs to it, and nothing else in the build would notice — so this script regenerates
 * every derived artifact from the source next to it, and CI fails on any resulting diff.
 *
 * Steps:
 *  1. `javac -g --release 21` into a temporary directory, then a major-version check — the same
 *     pinning build-fixtures.mjs does, and for the same reason: the committed class files must
 *     not change shape because a contributor upgraded their JDK.
 *  2. `java <Class>` for every runnable fixture, its standard output captured verbatim into
 *     `<Class>.stdout.txt`. This is the reference implementation's answer and the only reason
 *     the differential test proves anything.
 *  3. `javap` for every fixture that has a dump, normalised (see NORMALISATION below) and
 *     written back under the human-written `#` header the committed file already carries.
 *
 * Deterministic and idempotent: javac output carries no timestamps, the temporary directory is
 * removed afterwards, and the two parts of a `javap` dump that do not come from the class file
 * are normalised away. A second run produces byte-identical artifacts.
 *
 * Usage: `npm run fixtures:tests -w web` (requires the JDK named by REQUIRED_JAVAP_FEATURE).
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(FIXTURES_DIR, '..');

/** Java 21 (LTS), as everywhere else in this repository: major version 65 on every JDK >= 21. */
const JAVA_RELEASE = '21';
const EXPECTED_MAJOR_VERSION = 65;

/**
 * The feature release whose `javap` wrote the committed dumps.
 *
 * `javac --release 21` pins the class file, but nothing pins the disassembler's own formatting:
 * JDK 25 widened the offset column of `javap -c` by two spaces, so a JDK 21 javap regenerates
 * the same instructions in a different layout and every dump appears to have drifted. The dumps
 * are byte-exact artifacts, so the tool that produces them is pinned like the class file is.
 */
const REQUIRED_JAVAP_FEATURE = 25;

/**
 * NORMALISATION — the two things a `javap -v` dump says about the file rather than about the
 * class, and which therefore cannot survive a rebuild:
 *
 *  • the `Classfile` line names the absolute path javap was given. Replaced by the bare file
 *    name, which is what the committed dumps carry.
 *  • the `Last modified` line is the class file's mtime, in the JVM's default locale. A file
 *    javac has just written is stamped "now", so the dump is taken from a copy whose mtime is
 *    pinned to the instant below and with the locale forced to English. Midday UTC, so that the
 *    date does not fall back a day on a runner east or west of Greenwich.
 */
const PINNED_MTIME = new Date('2026-08-05T12:00:00Z');
const ENGLISH_LOCALE = ['-J-Duser.language=en', '-J-Duser.country=US'];

/**
 * Every fixture built from a `.java` source under `src/core`, with the artifacts derived from
 * it. `javap: 'verbose'` is `javap -v -p` (constant pool, attributes — what parser.test.ts
 * reads), `'code'` is `javap -c -p` (the instruction listing disassembler.test.ts parses).
 *
 * `runs` marks a fixture whose whole standard output is an expectation: the program prints
 * every value it computes, so `<Class>.stdout.txt` is the assertion in full.
 */
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
    // Deliberately outside the executable subset — the decoder is what it is for.
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
    className: 'Switches',
    directory: 'src/core/interpreter/__fixtures__/programs',
    javap: undefined,
    runs: true,
  },
]);

/** Build failure carrying a message ready to show a human (no stack trace). */
class FixtureBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureBuildError';
  }
}

/**
 * Runs a JDK tool and returns its stdout. A tool failure is turned into a FixtureBuildError
 * carrying its output — a bare `execFileSync` loses stderr from the message.
 */
function runTool(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    const stderr = typeof cause?.stderr === 'string' ? cause.stderr.trim() : '';
    const stdout = typeof cause?.stdout === 'string' ? cause.stdout.trim() : '';
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new FixtureBuildError(
      `Command "${command} ${args.join(' ')}" failed.` +
        (details ? `\n${details}` : `\n${String(cause?.message ?? cause)}`),
    );
  }
}

function sourcePath(fixture) {
  return join(WEB_DIR, fixture.directory, `${fixture.className}.java`);
}

function requirePinnedJavap() {
  // `javap -version` prints the release alone: "25-ea", "21.0.1".
  const reported = runTool('javap', ['-version']).trim();
  const feature = Number(/^\d+/.exec(reported)?.[0]);
  if (feature !== REQUIRED_JAVAP_FEATURE) {
    throw new FixtureBuildError(
      `javap ${reported} cannot reproduce the committed dumps, which were written by a JDK ` +
        `${REQUIRED_JAVAP_FEATURE} javap: the disassembly layout differs between releases.\n` +
        `Install JDK ${REQUIRED_JAVAP_FEATURE} and put it on PATH. Moving to another release ` +
        'means regenerating every dump with it and committing the result, plus raising ' +
        'REQUIRED_JAVAP_FEATURE here and the JDK version of the fixtures job in ' +
        '.github/workflows/web.yml.',
    );
  }
  return reported;
}

/**
 * A `.java` file nobody declared would be compiled by nothing and checked by nothing, which is
 * the same hole this script exists to close, one level up.
 */
function requireEverySourceDeclared() {
  const declared = new Set(FIXTURES.map((fixture) => sourcePath(fixture)));
  const undeclared = [];

  for (const directory of new Set(FIXTURES.map((fixture) => fixture.directory))) {
    for (const entry of readdirSync(join(WEB_DIR, directory))) {
      const path = join(WEB_DIR, directory, entry);
      if (entry.endsWith('.java') && !declared.has(path)) {
        undeclared.push(`${directory}/${entry}`);
      }
    }
  }

  if (undeclared.length > 0) {
    throw new FixtureBuildError(
      `These fixture sources are not declared in build-test-fixtures.mjs, so their class file ` +
        `and expected output are not rebuilt:\n${undeclared.map((path) => `  • ${path}`).join('\n')}\n\n` +
        'Add them to FIXTURES.',
    );
  }
}

function compileAll(classesDir) {
  runTool('javac', [
    '-g',
    '--release',
    JAVA_RELEASE,
    '-d',
    classesDir,
    ...FIXTURES.map((fixture) => sourcePath(fixture)),
  ]);
}

function readMajorVersion(classesDir, className) {
  const verbose = runTool('javap', ['-v', '-p', '-classpath', classesDir, className]);
  const match = /^\s*major version:\s*(\d+)\s*$/m.exec(verbose);
  if (!match) {
    throw new FixtureBuildError(`Could not read the major version of class ${className}.`);
  }
  return Number(match[1]);
}

/**
 * The leading `#` block of a dump: prose that says what the fixture is for and which command
 * produced it. javap does not write it and this script does not rewrite it — it is the one part
 * of the file a human owns. A dump that does not exist yet gets a stub naming its command.
 */
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

  // Pinned before the dump is taken, because `javap -v` reports the mtime it finds.
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

/** What the reference implementation printed, byte for byte. */
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
  const javapVersion = requirePinnedJavap();
  requireEverySourceDeclared();

  const classesDir = mkdtempSync(join(tmpdir(), 'jvm-bytecode-test-fixtures-'));
  try {
    console.log(`javac -g --release ${JAVA_RELEASE} → ${classesDir}  (javap ${javapVersion})`);
    compileAll(classesDir);

    for (const fixture of FIXTURES) {
      const { className } = fixture;
      const majorVersion = readMajorVersion(classesDir, className);
      if (majorVersion !== EXPECTED_MAJOR_VERSION) {
        throw new FixtureBuildError(
          `${className}.class has major version ${majorVersion}, expected ` +
            `${EXPECTED_MAJOR_VERSION} (Java ${JAVA_RELEASE}). Check the javac --release flag.`,
        );
      }

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
    rmSync(classesDir, { recursive: true, force: true });
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
