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
 *  4. Reference output from a real JVM: every example's `main` is run on its own and whatever
 *     it wrote to stdout becomes `expectedOutput`. Running `main` rather than asking the
 *     harness keeps the output exactly what the shipped class prints, with nothing in between.
 *  5. Copying `.class` + `.java` into `public/examples/` and generating `manifest.json`.
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
    'aconst_null',
    'iconst_m1',
    'iconst_0',
    'iconst_1',
    'iconst_2',
    'iconst_3',
    'iconst_4',
    'iconst_5',
    'bipush',
    'sipush',
    'ldc',
    'ldc_w',
  ],
  /** The `_w` forms are how javap prints an instruction carrying a `wide` prefix. */
  'load/store': [
    'iload',
    'iload_0',
    'iload_1',
    'iload_2',
    'iload_3',
    'iload_w',
    'aload',
    'aload_0',
    'aload_1',
    'aload_2',
    'aload_3',
    'aload_w',
    'istore',
    'istore_0',
    'istore_1',
    'istore_2',
    'istore_3',
    'istore_w',
    'astore',
    'astore_0',
    'astore_1',
    'astore_2',
    'astore_3',
    'astore_w',
  ],
  increment: ['iinc', 'iinc_w'],
  /** int arrays only: `newarray` with any other element type is rejected at run time. */
  arrays: ['newarray', 'iaload', 'iastore', 'arraylength'],
  stack: ['pop', 'pop2', 'dup', 'dup_x1', 'dup2', 'dup2_x1', 'swap'],
  arithmetic: ['iadd', 'isub', 'imul', 'idiv', 'irem', 'ineg'],
  'shifts and bitwise logic': ['ishl', 'ishr', 'iushr', 'iand', 'ior', 'ixor'],
  'narrowing conversions': ['i2b', 'i2c', 'i2s'],
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
  jump: ['goto', 'tableswitch', 'lookupswitch'],
  calls: ['invokestatic', 'invokevirtual', 'getstatic', 'ireturn', 'return'],
});

const ALLOWED_MNEMONICS = new Set(Object.values(SUPPORTED_INSTRUCTION_SET).flat());

/**
 * The members of the standard library the interpreter answers for, written the way javap
 * prints them in a `//` comment.
 *
 * **Keep in sync** with the table in `src/core/interpreter/externals.ts` — this is a
 * whitelist, so lagging behind it only ever rejects an example that would have run, never
 * lets through one that would not.
 */
const EXTERNAL_MEMBERS = Object.freeze([
  'java/lang/System.out:Ljava/io/PrintStream;',
  'java/io/PrintStream.println:()V',
  ...['I', 'Z', 'C', 'Ljava/lang/String;'].flatMap((parameter) => [
    `java/io/PrintStream.print:(${parameter})V`,
    `java/io/PrintStream.println:(${parameter})V`,
  ]),
  'java/lang/Math.max:(II)I',
  'java/lang/Math.min:(II)I',
  'java/lang/Math.abs:(I)I',
  'java/lang/Math.floorDiv:(II)I',
  'java/lang/Math.floorMod:(II)I',
]);

const ALLOWED_EXTERNALS = new Set(EXTERNAL_MEMBERS);

/**
 * The mnemonic alone is not enough: `invokestatic` is in scope, but a call into another class
 * only reaches the members listed in `EXTERNAL_MEMBERS`, and a call inside the example itself
 * only carries `I` parameters and an `I`/`V` return type. javap prints the call target without
 * a class name when it belongs to the class being disassembled ("Method gcd:(II)I") and with
 * one otherwise ("Method java/lang/Math.max:(II)I"), which is how the two are told apart.
 */
const METHOD_REFERENCE = /^Method\s+(\S+):(\(\S*\)\S+)$/;
const FIELD_REFERENCE = /^Field\s+(\S+):(\S+)$/;
const SUPPORTED_DESCRIPTOR = /^\(I*\)[IV]$/;

/** `ldc` pushes an int or a String; javap names the constant's kind ahead of its value. */
const CONSTANT_KIND = /^(\w+)\b/;
const LOADABLE_CONSTANT_KINDS = new Set(['int', 'String']);

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
  {
    id: 'bubble-sort',
    className: 'BubbleSort',
    title: 'Bubble sort — arrays on the heap',
    tagline: 'The heap in motion: {5,3,4,1,2} swapped into order.',
    description:
      'Bubble sort over {5, 3, 4, 1, 2}. The one example with an array: newarray allocates ' +
      'it, iastore fills it and iaload reads back the two neighbours every comparison needs. ' +
      'Each swap rewrites the heap, and result ends up holding a[0] = 1 — the minimum the ' +
      'sort moved to the front.',
  },
  {
    id: 'collatz',
    className: 'Collatz',
    title: 'Collatz — printing as it runs',
    tagline: 'Console fills line by line: 7 falls to 1.',
    description:
      'The Collatz sequence from 7, printed term by term. Halve an even number, triple an ' +
      'odd one and add one: sixteen steps later it reaches 1. The only example that prints, ' +
      'so the console grows by a line per iteration — getstatic reads System.out and ' +
      'invokevirtual hands it the number.',
  },
  {
    id: 'days-in-year',
    className: 'DaysInYear',
    title: 'Days in a year — switch dispatch',
    tagline: 'One jump table, twelve months, 365 days.',
    description:
      'The length of a common year, month by month. Dense case labels make javac emit ' +
      'tableswitch: ten table entries for five cases, so the four thirty-day months share a ' +
      'target and the months missing from the table fall to the default one. Every call ' +
      'reaches its arm in the same number of steps, whatever the month.',
  },
  {
    id: 'fast-power',
    className: 'FastPower',
    title: 'Fast power — shifts and masks',
    tagline: 'Reading 13 bit by bit: 3^13 in four steps.',
    description:
      'Exponentiation by squaring, 3^13 = 1594323. The bits of the exponent are the ' +
      'algorithm: iand against a mask of one asks whether the lowest bit is set, iushr ' +
      'throws it away and brings down the next. Four iterations instead of thirteen ' +
      'multiplications, and the operand stack does the work in plain sight.',
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
 * Checks whether a single `invokestatic` is in scope: either a method of the same class whose
 * descriptor is made of `I` parameters and an `I`/`V` return type, or one of the standard
 * library methods the interpreter answers for itself.
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
    return checkExternal('invokestatic', `${target}:${descriptor}`);
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
 * Checks an `invokevirtual` or a `getstatic`. Neither has an in-class form: there are no
 * instance methods and no static fields in an example, so the member has to be an external
 * one — `System.out` and the `PrintStream` methods that write to it.
 *
 * @returns {string | null} a description of the violation, or null when the member is in scope
 */
function checkMemberReference(mnemonic, comment) {
  const pattern = mnemonic === 'getstatic' ? FIELD_REFERENCE : METHOD_REFERENCE;
  const reference = pattern.exec(comment);
  if (!reference) {
    return `could not read the ${mnemonic} target from the javap comment ("${comment}")`;
  }
  return checkExternal(mnemonic, `${reference[1]}:${reference[2]}`);
}

function checkExternal(mnemonic, member) {
  if (ALLOWED_EXTERNALS.has(member)) {
    return null;
  }
  return (
    `${mnemonic} ${member} — the interpreter recognises no such member of the standard ` +
    `library. Available are:\n${EXTERNAL_MEMBERS.map((known) => `      ${known}`).join('\n')}`
  );
}

/**
 * Checks an `ldc`. The constant pool holds far more than the interpreter can push, so the
 * kind javap names decides: an int or a String constant, and nothing else.
 *
 * @returns {string | null} a description of the violation, or null when the constant is loadable
 */
function checkConstant(comment) {
  const kind = CONSTANT_KIND.exec(comment);
  if (!kind) {
    return `could not read the constant kind from the javap comment ("${comment}")`;
  }
  if (!LOADABLE_CONSTANT_KINDS.has(kind[1])) {
    return `ldc of a ${kind[1]} constant — only int and String constants can be pushed`;
  }
  return null;
}

/**
 * What an in-scope mnemonic still has to answer for: which member it reaches, or which
 * constant it pushes. Every other instruction is decided by its mnemonic alone.
 *
 * @returns {string | null} a description of the violation, or null when the operand is in scope
 */
function checkOperands(mnemonic, comment) {
  switch (mnemonic) {
    case 'invokestatic':
      return checkInvokeStatic(comment);
    case 'invokevirtual':
    case 'getstatic':
      return checkMemberReference(mnemonic, comment);
    case 'ldc':
    case 'ldc_w':
      return checkConstant(comment);
    default:
      return null;
  }
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
      const problem = checkOperands(mnemonic, comment);
      if (problem !== null) {
        violations.push(`${where}  offset ${offset}: ${problem}`);
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

/**
 * Runs one example's `main` on a real JVM and returns the lines it printed.
 *
 * The class that runs here is the class that ships, entered where the interpreter enters it,
 * so the output needs no harness to vouch for it. It doubles as proof that every example
 * really does run to completion outside the browser.
 */
function readPrintedOutput(classesDir, className) {
  const stdout = runTool('java', ['-classpath', classesDir, className]);
  const lines = stdout.split('\n');
  // A trailing newline ends the last line; it does not begin an empty one.
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function writeArtifacts(classesDir, expectedResults, printedOutput) {
  // The directory is recreated from scratch: otherwise a removed example would leave an orphaned .class.
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const entries = EXAMPLES.map((example) => {
    const classFile = `${example.className}.class`;
    const sourceFile = `${example.className}.java`;
    copyFileSync(join(classesDir, classFile), join(OUTPUT_DIR, classFile));
    copyFileSync(join(SOURCE_DIR, sourceFile), join(OUTPUT_DIR, sourceFile));

    const printed = printedOutput.get(example.id) ?? [];

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
      // Omitted for the examples that print nothing, which is most of them: the schema reads
      // an absent field as no output at all, and the manifest stays about what did happen.
      ...(printed.length > 0 ? { expectedOutput: printed } : {}),
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
    const printedOutput = new Map(
      EXAMPLES.map((example) => [example.id, readPrintedOutput(classesDir, example.className)]),
    );
    const manifest = writeArtifacts(classesDir, expectedResults, printedOutput);

    console.log(`\nReference results from a real JVM (harness ${HARNESS_CLASS}):`);
    for (const entry of manifest.examples) {
      const printed = entry.expectedOutput?.length ?? 0;
      const output = printed === 0 ? '' : `, ${printed} line(s) printed by main`;
      console.log(`  ${entry.id} → ${entry.expectedResult}${output}`);
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
