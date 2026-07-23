#!/usr/bin/env node
/**
 * Builds the example fixtures shipped in `public/examples/`.
 *
 * Steps:
 *  1. `javac -g --release 21` into a temporary directory (`-g` produces a LocalVariableTable,
 *     i.e. variable names in the UI; `--release 21` pins major version 65 regardless of how
 *     new the developer's JDK is).
 *  2. Instruction scope validation: `javap -c -p` on every class, and every mnemonic must
 *     belong to the supported instruction set. An instruction outside that set fails the
 *     build, so an example can never silently drift beyond what the interpreter can run.
 *  3. Reference results from a real JVM: the `ExpectedResults` harness calls the compute
 *     methods of the examples and prints the results; they land in the manifest as
 *     `expectedResult` and drive the interpreter's differential test.
 *  4. Copying `.class` + `.java` into `public/examples/` and generating `manifest.json`.
 *
 * The script is deterministic and idempotent: the output directory is recreated from scratch,
 * the manifest order follows the EXAMPLES array, and javac output carries no timestamps —
 * a second run produces byte-for-byte identical artifacts.
 *
 * Usage: `npm run fixtures -w web` (requires a local JDK >= 21).
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(FIXTURES_DIR, 'src');
const HARNESS_DIR = join(FIXTURES_DIR, 'harness');
const OUTPUT_DIR = join(FIXTURES_DIR, '..', 'public', 'examples');

/** The harness computes the reference results; it is deliberately NOT copied to public/examples. */
const HARNESS_CLASS = 'ExpectedResults';

/** Java 21 (LTS). `--release` guarantees this major version on every JDK >= 21. */
const JAVA_RELEASE = '21';
const EXPECTED_MAJOR_VERSION = 65;

/** Manifest format version; consumers validate it with the schema in src/services/manifest.ts. */
const MANIFEST_VERSION = 1;

/**
 * The supported instruction set. Grouping by family lets an error message say not only
 * "this mnemonic is not allowed" but also which families are available at all.
 */
const SUPPORTED_INSTRUCTION_SET = Object.freeze({
  constants: [
    'nop',
    'iconst_m1',
    'iconst_0',
    'iconst_1',
    'iconst_2',
    'iconst_3',
    'iconst_4',
    'iconst_5',
    'bipush',
    'sipush',
  ],
  'load/store': [
    'iload',
    'iload_0',
    'iload_1',
    'iload_2',
    'iload_3',
    'istore',
    'istore_0',
    'istore_1',
    'istore_2',
    'istore_3',
  ],
  increment: ['iinc'],
  stack: ['dup', 'pop'],
  arithmetic: ['iadd', 'isub', 'imul', 'idiv', 'irem', 'ineg'],
  'comparison branches': [
    'if_icmpeq',
    'if_icmpne',
    'if_icmplt',
    'if_icmpge',
    'if_icmpgt',
    'if_icmple',
    'ifeq',
    'ifne',
    'iflt',
    'ifge',
    'ifgt',
    'ifle',
  ],
  jump: ['goto'],
  calls: ['invokestatic', 'ireturn', 'return'],
});

const ALLOWED_MNEMONICS = new Set(Object.values(SUPPORTED_INSTRUCTION_SET).flat());

/**
 * The mnemonic alone is not enough: `invokestatic` is in scope, but only calls to methods of
 * THE SAME class are supported, and only descriptors with `I` parameters and an `I`/`V` return
 * type. javap prints the call target without a class name when it belongs to the class being
 * disassembled ("Method gcd:(II)I") and with one otherwise ("Method java/lang/Math.max:(II)I"),
 * which is how the two are told apart.
 */
const METHOD_REFERENCE = /^Method\s+(\S+):(\(\S*\)\S+)$/;
const SUPPORTED_DESCRIPTOR = /^\(I*\)[IV]$/;

/** javap prints signatures in Java syntax, not as descriptors. */
const MAIN_SIGNATURE = 'public static void main(java.lang.String[])';
const SUPPORTED_SIGNATURE = /^(?:\w+\s+)*?(?:int|void)\s+\w+\(\s*(?:int(?:\s*,\s*int)*)?\s*\)$/;

/**
 * Examples in the order they are presented in the UI. Each `id` must match the key printed by
 * the harness — the script checks this, so a name mismatch fails the build, not a test.
 *
 * `tagline` is the one line the welcome card shows; `description` is the longer text behind
 * the toolbar tooltip. Two fields rather than one truncated string, so neither is cut mid-word.
 */
const EXAMPLES = Object.freeze([
  {
    id: 'factorial',
    className: 'Factorial',
    title: 'Factorial — recursion',
    tagline: 'Five frames deep and back: 4! = 24.',
    description:
      'Recursive 4! = 24. Watch the call stack grow to five frames (main plus four calls) ' +
      'and unwind again, multiplying results on the way back — the clearest way to see how ' +
      'the JVM resumes a method exactly where it left off.',
  },
  {
    id: 'fibonacci',
    className: 'Fibonacci',
    title: 'Fibonacci — branching recursion',
    tagline: 'Every call splits in two: fib(7) = 13.',
    description:
      'Naive fib(7) = 13. Every call branches into two more, so the stack grows and unwinds ' +
      'dozens of times. A vivid look at the cost of naive recursion: the same subproblems ' +
      'are recomputed from scratch again and again.',
  },
  {
    id: 'sum-of-products',
    className: 'SumOfProducts',
    title: 'Sum of products — nested for loops',
    tagline: 'Flat stack, long run: Σ i·j over a 6×6 grid.',
    description:
      'Sum of i*j over a 6x6 grid. A flat call stack but hundreds of steps: it showcases ' +
      'iinc (incrementing a counter in place, without touching the operand stack), the ' +
      'if_icmpgt condition and the backward goto.',
  },
  {
    id: 'gcd',
    className: 'Gcd',
    title: 'GCD — while loop and remainder',
    tagline: "Euclid's loop on (1071, 462) = 21.",
    description:
      "Euclid's algorithm for (1071, 462) = 21. A loop driven by a condition rather than a " +
      'counter: instead of iinc there is ifne on the remainder (irem), plus values being ' +
      'copied between local variable slots.',
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

function compileAll(classesDir) {
  const sources = [
    ...EXAMPLES.map((example) => join(SOURCE_DIR, `${example.className}.java`)),
    join(HARNESS_DIR, `${HARNESS_CLASS}.java`),
  ];
  runTool('javac', ['-g', '-Xlint:all', '--release', JAVA_RELEASE, '-d', classesDir, ...sources]);
}

/**
 * Splits `javap -c -p` output into methods and their instructions.
 *
 * The javap format is stable and simple: a method header is an indented line ending with a
 * semicolon, and an instruction is `<offset>: <mnemonic> [operands]`. javap prints constructors
 * without a return type (`private Factorial();`) and the static initialiser as `static {};` —
 * both forms are recognised because the interpreter never executes them, so they are exempt
 * from scope validation.
 */
function parseDisassembly(javapOutput, className) {
  const constructorPattern = new RegExp(`(?:^|\\s)${className}\\s*\\(`);
  const methods = [];
  let current = null;

  for (const line of javapOutput.split('\n')) {
    const instruction = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/.exec(line);
    if (instruction) {
      if (current === null) {
        // An instruction before any method header means javap changed its format. Better to
        // fail the build than to silently let unvalidated bytecode through.
        throw new FixtureBuildError(
          `Unexpected javap output format for class ${className}: instruction "${line.trim()}" ` +
            'appeared before any method header.',
        );
      }
      const operands = instruction[3];
      const commentAt = operands.indexOf('//');
      current.instructions.push({
        offset: Number(instruction[1]),
        mnemonic: instruction[2],
        comment: commentAt === -1 ? '' : operands.slice(commentAt + 2).trim(),
      });
      continue;
    }

    const signature = /^\s{2}(\S.*);\s*$/.exec(line);
    if (signature) {
      const text = signature[1].trim();
      const kind = text.startsWith('static {}')
        ? 'class-init'
        : constructorPattern.test(text)
          ? 'instance-init'
          : 'method';
      current = { signature: text, kind, instructions: [] };
      methods.push(current);
    }
  }

  return methods;
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
 * Checks whether a single `invokestatic` is in scope: the target must be a method of the same
 * class with a descriptor made of `I` parameters and an `I`/`V` return type.
 *
 * @returns {string | null} a description of the violation, or null when the call is in scope
 */
function checkInvokeStatic(comment) {
  const reference = METHOD_REFERENCE.exec(comment);
  if (!reference) {
    return `could not read the call target from the javap comment ("${comment}")`;
  }

  const [, target, descriptor] = reference;
  if (target.includes('.') || target.includes('/')) {
    return (
      `invokestatic into another class (${target}) — only calls to methods of the same ` +
      'class are supported'
    );
  }
  if (!SUPPORTED_DESCRIPTOR.test(descriptor)) {
    return (
      `invokestatic ${target} with descriptor ${descriptor} — only I parameters and an ` +
      'I/V return type are supported'
    );
  }
  return null;
}

/**
 * Checks that the executable methods of a class are in scope: static, with `int`-only
 * signatures, built exclusively from supported instructions. `<init>`/`<clinit>` methods are
 * skipped because the interpreter never executes them — but the mere presence of `<clinit>`
 * is an error, since it means the class has a static field.
 *
 * All violations are collected and reported at once: fixing an example one message per run
 * would be tedious.
 */
function validateScope(className, methods) {
  if (methods.some((method) => method.kind === 'class-init')) {
    throw new FixtureBuildError(
      `Class ${className} has a static initialiser <clinit>. ` +
        'Examples must not use static fields — the interpreter never executes <clinit>, so ' +
        'the program would observe uninitialised state.',
    );
  }

  const mainMethods = methods.filter((method) => method.signature === MAIN_SIGNATURE);
  if (mainMethods.length !== 1) {
    throw new FixtureBuildError(
      `Class ${className} must have exactly one "${MAIN_SIGNATURE}" method ` +
        `(found ${mainMethods.length}) — it is the interpreter's entry point.`,
    );
  }

  const violations = [];
  let instructionCount = 0;

  for (const method of methods) {
    if (method.kind !== 'method') {
      continue;
    }

    const where = `${className}::${method.signature}`;
    if (!/(?:^|\s)static\s/.test(method.signature)) {
      violations.push(`${where} — non-static method; only invokestatic is supported`);
    }
    if (method.signature !== MAIN_SIGNATURE && !SUPPORTED_SIGNATURE.test(method.signature)) {
      violations.push(
        `${where} — unsupported signature; allowed are int parameters with an int/void ` +
          `return type, or exactly "${MAIN_SIGNATURE}"`,
      );
    }

    for (const { offset, mnemonic, comment } of method.instructions) {
      instructionCount += 1;
      if (!ALLOWED_MNEMONICS.has(mnemonic)) {
        violations.push(`${where}  offset ${offset}: ${mnemonic} — unsupported instruction`);
        continue;
      }
      if (mnemonic === 'invokestatic') {
        const problem = checkInvokeStatic(comment);
        if (problem !== null) {
          violations.push(`${where}  offset ${offset}: ${problem}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    const details = violations.map((violation) => `  • ${violation}`).join('\n');
    const families = Object.entries(SUPPORTED_INSTRUCTION_SET)
      .map(([family, mnemonics]) => `  ${family}: ${mnemonics.join(', ')}`)
      .join('\n');
    throw new FixtureBuildError(
      `The example goes beyond the supported instruction set:\n${details}\n\n` +
        `Allowed instructions:\n${families}\n\n` +
        'Fix the example source (e.g. the loop bounds or the Java constructs it uses) — ' +
        'the interpreter scope is not widened to accommodate an example.',
    );
  }

  return instructionCount;
}

/** Runs the harness on a real JVM and returns a map of id → result. */
function readExpectedResults(classesDir) {
  const stdout = runTool('java', ['-classpath', classesDir, HARNESS_CLASS]);
  const results = new Map();

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const match = /^([a-z0-9-]+)=(-?\d+)$/.exec(trimmed);
    if (!match) {
      throw new FixtureBuildError(
        `Harness ${HARNESS_CLASS} printed a line in an unexpected format: "${trimmed}". ` +
          'The expected format is "<id>=<integer>".',
      );
    }
    results.set(match[1], Number(match[2]));
  }

  const declared = EXAMPLES.map((example) => example.id).sort();
  const reported = [...results.keys()].sort();
  if (declared.join(',') !== reported.join(',')) {
    throw new FixtureBuildError(
      `Harness ${HARNESS_CLASS} reports different examples than build-fixtures.mjs declares.\n` +
        `  declared: ${declared.join(', ')}\n` +
        `  reported: ${reported.join(', ')}`,
    );
  }

  return results;
}

function writeArtifacts(classesDir, expectedResults) {
  // The directory is recreated from scratch: otherwise a removed example would leave an orphaned .class.
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const entries = EXAMPLES.map((example) => {
    const classFile = `${example.className}.class`;
    const sourceFile = `${example.className}.java`;
    copyFileSync(join(classesDir, classFile), join(OUTPUT_DIR, classFile));
    copyFileSync(join(SOURCE_DIR, sourceFile), join(OUTPUT_DIR, sourceFile));

    return {
      id: example.id,
      title: example.title,
      tagline: example.tagline,
      description: example.description,
      classFile,
      sourceFile,
      entryMethod: 'main',
      resultVariable: 'result',
      expectedResult: expectedResults.get(example.id),
    };
  });

  const manifest = { version: MANIFEST_VERSION, examples: entries };
  writeFileSync(
    join(OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

function main() {
  const classesDir = mkdtempSync(join(tmpdir(), 'jvm-bytecode-fixtures-'));
  try {
    console.log(`javac -g --release ${JAVA_RELEASE} → ${classesDir}`);
    compileAll(classesDir);

    let totalInstructions = 0;
    for (const example of EXAMPLES) {
      const { className } = example;

      const majorVersion = readMajorVersion(classesDir, className);
      if (majorVersion !== EXPECTED_MAJOR_VERSION) {
        throw new FixtureBuildError(
          `${className}.class has major version ${majorVersion}, expected ` +
            `${EXPECTED_MAJOR_VERSION} (Java ${JAVA_RELEASE}). Check the javac --release flag.`,
        );
      }

      const methods = parseDisassembly(
        runTool('javap', ['-c', '-p', '-classpath', classesDir, className]),
        className,
      );
      const instructionCount = validateScope(className, methods);
      totalInstructions += instructionCount;

      const perMethod = methods
        .filter((method) => method.kind === 'method')
        .map((method) => `${method.signature} = ${method.instructions.length}`)
        .join(', ');
      console.log(
        `  ✓ ${className}  major=${majorVersion}, in-scope instructions: ` +
          `${instructionCount} (${perMethod})`,
      );
    }

    const expectedResults = readExpectedResults(classesDir);
    const manifest = writeArtifacts(classesDir, expectedResults);

    console.log(`\nReference results from a real JVM (harness ${HARNESS_CLASS}):`);
    for (const entry of manifest.examples) {
      console.log(`  ${entry.id} → ${entry.expectedResult}`);
    }
    console.log(
      `\nDone: ${manifest.examples.length} examples, ${totalInstructions} instructions ` +
        `validated against the supported instruction set.\nArtifacts: ${OUTPUT_DIR}`,
    );
  } finally {
    rmSync(classesDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (error instanceof FixtureBuildError) {
    console.error(`\nbuild-fixtures: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
