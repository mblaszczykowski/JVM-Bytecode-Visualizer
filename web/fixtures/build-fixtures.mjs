#!/usr/bin/env node

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FixtureBuildError,
  JAVA_RELEASE,
  requireExpectedMajorVersion,
  requirePinnedJdk,
  runTool,
} from './jdk.mjs';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(FIXTURES_DIR, 'src');
const HARNESS_DIR = join(FIXTURES_DIR, 'harness');
const OUTPUT_DIR = join(FIXTURES_DIR, '..', 'public', 'examples');

const HARNESS_CLASS = 'ExpectedResults';

const MANIFEST_VERSION = 1;

// Every mnemonic the interpreter executes, grouped for the error message below. The grouping is
// presentational; fixtures/build-fixtures.test.ts asserts that the flattened set is exactly the
// set of opcodes src/core/disassembler/opcodes.ts gives a stack effect to, so this cannot drift.
export const SUPPORTED_INSTRUCTION_SET = Object.freeze({
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
  arrays: ['newarray', 'iaload', 'iastore', 'arraylength'],
  objects: ['new', 'getfield', 'putfield'],
  stack: ['pop', 'pop2', 'dup', 'dup_x1', 'dup_x2', 'dup2', 'dup2_x1', 'dup2_x2', 'swap'],
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
  'reference comparisons': ['if_acmpeq', 'if_acmpne', 'ifnull', 'ifnonnull'],
  jump: ['goto', 'tableswitch', 'lookupswitch'],
  calls: ['invokestatic', 'invokevirtual', 'invokespecial', 'getstatic'],
  returns: ['ireturn', 'areturn', 'return'],
  exceptions: ['athrow'],
});

export const ALLOWED_MNEMONICS = new Set(Object.values(SUPPORTED_INSTRUCTION_SET).flat());

// The members of the standard library the interpreter implements. Kept equal to
// EXTERNAL_FIELDS and EXTERNAL_METHODS in src/core/interpreter/externals.ts by the same test.
export const EXTERNAL_MEMBERS = Object.freeze([
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

const SUPER_CONSTRUCTOR = 'java/lang/Object."<init>":()V';

const METHOD_REFERENCE = /^Method\s+(\S+):(\(\S*\)\S+)$/;
const FIELD_REFERENCE = /^Field\s+(\S+):(\S+)$/;
const CLASS_REFERENCE = /^class\s+(\S+)$/;

const CONSTANT_KIND = /^(\w+)\b/;
const LOADABLE_CONSTANT_KINDS = new Set(['int', 'String']);

const MAIN_SIGNATURE = 'public static void main(java.lang.String[])';

const EXAMPLES = Object.freeze([
  {
    id: 'factorial',
    className: 'Factorial',
    title: 'Factorial: recursion',
    tagline: 'Five frames deep and back: 4! = 24.',
    description:
      'Recursive 4! = 24. The call stack grows to five frames (main plus four calls) and ' +
      'unwinds again, multiplying results on the way back, which shows how the JVM resumes a ' +
      'method exactly where it left off.',
  },
  {
    id: 'fibonacci',
    className: 'Fibonacci',
    title: 'Fibonacci: branching recursion',
    tagline: 'Every call splits in two: fib(7) = 13.',
    description:
      'Naive fib(7) = 13. Every call branches into two more, so the stack grows and unwinds ' +
      'dozens of times. The cost of naive recursion is visible: the same subproblems are ' +
      'recomputed from scratch again and again.',
  },
  {
    id: 'sum-of-products',
    className: 'SumOfProducts',
    title: 'Sum of products: nested for loops',
    tagline: 'Flat stack, long run: Σ i·j over a 6×6 grid.',
    description:
      'Sum of i*j over a 6x6 grid. A flat call stack but hundreds of steps, covering iinc ' +
      '(incrementing a counter in place, without touching the operand stack), the if_icmpgt ' +
      'condition and the backward goto.',
  },
  {
    id: 'gcd',
    className: 'Gcd',
    title: 'GCD: while loop and remainder',
    tagline: "Euclid's loop on (1071, 462) = 21.",
    description:
      "Euclid's algorithm for (1071, 462) = 21. The loop condition compiles to ifne on the " +
      'remainder from irem, and the body copies values between local variable slots.',
  },
  {
    id: 'bubble-sort',
    className: 'BubbleSort',
    title: 'Bubble sort: arrays on the heap',
    tagline: 'An array on the heap: {5,3,4,1,2} sorted in place.',
    description:
      'Bubble sort over {5, 3, 4, 1, 2}. The one example with an array: newarray allocates ' +
      'it, iastore fills it and iaload reads back the two neighbours every comparison needs. ' +
      'Each swap rewrites the heap, and result ends up holding a[0] = 1, the minimum the ' +
      'sort moved to the front.',
  },
  {
    id: 'collatz',
    className: 'Collatz',
    title: 'Collatz: printing as it runs',
    tagline: 'One console line per step: 7 falls to 1.',
    description:
      'The Collatz sequence from 7, printed term by term. Halve an even number, triple an ' +
      'odd one and add one: sixteen steps later it reaches 1. The only example that prints, ' +
      'so the console grows by a line per iteration; getstatic reads System.out and ' +
      'invokevirtual hands it the number.',
  },
  {
    id: 'days-in-year',
    className: 'DaysInYear',
    title: 'Days in a year: switch dispatch',
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
    title: 'Fast power: shifts and masks',
    tagline: 'Reading 13 bit by bit: 3^13 in four steps.',
    description:
      'Exponentiation by squaring, 3^13 = 1594323. The bits of the exponent drive the loop: ' +
      'iand against a mask of one asks whether the lowest bit is set, iushr throws it away ' +
      'and brings down the next. Four iterations instead of thirteen multiplications, with ' +
      'the operand stack doing the work.',
  },
]);

function compileAll(classesDir) {
  const sources = [
    ...EXAMPLES.map((example) => join(SOURCE_DIR, `${example.className}.java`)),
    join(HARNESS_DIR, `${HARNESS_CLASS}.java`),
  ];
  runTool('javac', ['-g', '-Xlint:all', '--release', JAVA_RELEASE, '-d', classesDir, ...sources]);
}

/**
 * @typedef {{ offset: number; mnemonic: string; comment: string }} ParsedInstruction
 * @typedef {'method' | 'class-init' | 'instance-init'} MethodKind
 * @typedef {{ signature: string; kind: MethodKind; instructions: ParsedInstruction[] }} ParsedMethod
 */

function parseDisassembly(javapOutput, className) {
  const constructorPattern = new RegExp(`(?:^|\\s)${className}\\s*\\(`);
  /** @type {ParsedMethod[]} */
  const methods = [];
  /** @type {ParsedMethod | null} */
  let current = null;

  for (const line of javapOutput.split('\n')) {
    const instruction = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/.exec(line);
    if (instruction) {
      if (current === null) {
        throw new FixtureBuildError(
          `Unexpected javap output format for class ${className}: instruction "${line.trim()}" ` +
            'appeared before any method header.',
        );
      }
      const [, offset = '', mnemonic = '', operands = ''] = instruction;
      const commentAt = operands.indexOf('//');
      current.instructions.push({
        offset: Number(offset),
        mnemonic,
        comment: commentAt === -1 ? '' : operands.slice(commentAt + 2).trim(),
      });
      continue;
    }

    const signature = /^\s{2}(\S.*);\s*$/.exec(line);
    if (signature) {
      const text = (signature[1] ?? '').trim();
      /** @type {MethodKind} */
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

function ownType(className) {
  return `(?:int|${className})`;
}

function supportedSignature(className) {
  const type = ownType(className);
  return new RegExp(
    `^(?:\\w+\\s+)*?(?:void|${type})\\s+\\w+\\(\\s*(?:${type}(?:\\s*,\\s*${type})*)?\\s*\\)$`,
  );
}

function supportedDescriptor(className) {
  return new RegExp(`^\\((?:I|L${className};)*\\)(?:V|I|L${className};)$`);
}

function supportedFieldType(className) {
  return new RegExp(`^(?:I|L${className};)$`);
}

function isExternalMember(target) {
  return target.includes('.') || target.includes('/');
}

function checkCall(className, mnemonic, comment) {
  const reference = METHOD_REFERENCE.exec(comment);
  const target = reference?.[1];
  const descriptor = reference?.[2];
  if (target === undefined || descriptor === undefined) {
    return `could not read the ${mnemonic} target from the javap comment ("${comment}")`;
  }

  const member = `${target}:${descriptor}`;
  if (isExternalMember(target)) {
    return mnemonic === 'invokespecial' && member === SUPER_CONSTRUCTOR
      ? null
      : checkExternal(mnemonic, member);
  }
  if (!supportedDescriptor(className).test(descriptor)) {
    return (
      `${mnemonic} ${member}; a method of the example takes int and ${className} parameters ` +
      `and returns int, void or ${className}`
    );
  }
  return null;
}

function checkFieldAccess(className, mnemonic, comment) {
  const reference = FIELD_REFERENCE.exec(comment);
  const target = reference?.[1];
  const descriptor = reference?.[2];
  if (target === undefined || descriptor === undefined) {
    return `could not read the ${mnemonic} target from the javap comment ("${comment}")`;
  }

  if (isExternalMember(target)) {
    return checkExternal(mnemonic, `${target}:${descriptor}`);
  }
  if (mnemonic === 'getstatic') {
    return (
      `getstatic ${target}: a static field of the example itself. The interpreter never runs ` +
      '<clinit>, so the program would read uninitialised state.'
    );
  }
  if (!supportedFieldType(className).test(descriptor)) {
    return `${mnemonic} ${target}:${descriptor}; an instance field holds an int or a ${className}`;
  }
  return null;
}

function checkAllocation(className, comment) {
  const allocated = CLASS_REFERENCE.exec(comment)?.[1];
  if (allocated === undefined) {
    return `could not read the allocated class from the javap comment ("${comment}")`;
  }
  if (allocated !== className) {
    return (
      `new ${allocated}: there is no second class file to load, so an example can only ` +
      `instantiate ${className} itself`
    );
  }
  return null;
}

function checkExternal(mnemonic, member) {
  if (ALLOWED_EXTERNALS.has(member)) {
    return null;
  }
  return (
    `${mnemonic} ${member}: the interpreter recognises no such member of the standard ` +
    `library. Available are:\n${EXTERNAL_MEMBERS.map((known) => `      ${known}`).join('\n')}`
  );
}

function checkConstant(comment) {
  const kind = CONSTANT_KIND.exec(comment)?.[1];
  if (kind === undefined) {
    return `could not read the constant kind from the javap comment ("${comment}")`;
  }
  if (!LOADABLE_CONSTANT_KINDS.has(kind)) {
    return `ldc of a ${kind} constant; only int and String constants can be pushed`;
  }
  return null;
}

function checkOperands(className, mnemonic, comment) {
  switch (mnemonic) {
    case 'invokestatic':
    case 'invokevirtual':
    case 'invokespecial':
      return checkCall(className, mnemonic, comment);
    case 'getstatic':
    case 'getfield':
    case 'putfield':
      return checkFieldAccess(className, mnemonic, comment);
    case 'new':
      return checkAllocation(className, comment);
    case 'ldc':
    case 'ldc_w':
      return checkConstant(comment);
    default:
      return null;
  }
}

function validateScope(className, methods) {
  if (methods.some((method) => method.kind === 'class-init')) {
    throw new FixtureBuildError(
      `Class ${className} has a static initialiser <clinit>. ` +
        'Examples must not use static fields: the interpreter never executes <clinit>, so ' +
        'the program would observe uninitialised state.',
    );
  }

  const mainMethods = methods.filter((method) => method.signature === MAIN_SIGNATURE);
  if (mainMethods.length !== 1) {
    throw new FixtureBuildError(
      `Class ${className} must have exactly one "${MAIN_SIGNATURE}" method ` +
        `(found ${mainMethods.length}); it is the interpreter's entry point.`,
    );
  }

  const violations = [];
  const signatureOf = supportedSignature(className);
  let instructionCount = 0;

  for (const method of methods) {
    const where = `${className}::${method.signature}`;
    if (
      method.kind === 'method' &&
      method.signature !== MAIN_SIGNATURE &&
      !signatureOf.test(method.signature)
    ) {
      violations.push(
        `${where}: unsupported signature; allowed are int and ${className} parameters with an ` +
          `int, void or ${className} return type, or exactly "${MAIN_SIGNATURE}"`,
      );
    }

    for (const { offset, mnemonic, comment } of method.instructions) {
      instructionCount += 1;
      if (!ALLOWED_MNEMONICS.has(mnemonic)) {
        violations.push(`${where}  offset ${offset}: ${mnemonic} is not supported`);
        continue;
      }
      const problem = checkOperands(className, mnemonic, comment);
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
        'Fix the example source (e.g. the loop bounds or the Java constructs it uses); ' +
        'the interpreter scope is not widened to accommodate an example.',
    );
  }

  return instructionCount;
}

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

function readPrintedOutput(classesDir, className) {
  const stdout = runTool('java', ['-classpath', classesDir, className]);
  const lines = stdout.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function writeArtifacts(classesDir, expectedResults, printedOutput) {
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
  const jdk = requirePinnedJdk();

  const classesDir = mkdtempSync(join(tmpdir(), 'jvm-bytecode-fixtures-'));
  try {
    console.log(`javac -g --release ${JAVA_RELEASE} → ${classesDir}  (${jdk})`);
    compileAll(classesDir);

    let totalInstructions = 0;
    for (const example of EXAMPLES) {
      const { className } = example;

      const majorVersion = requireExpectedMajorVersion(classesDir, className);
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

// Guarded so that fixtures/build-fixtures.test.ts can import the tables above without compiling
// anything.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
