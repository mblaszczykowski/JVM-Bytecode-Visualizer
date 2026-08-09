import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile } from '../core/classfile';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import { AccessFlag } from '../core/classfile';

import { readExampleBytes, readExampleText, readFixtureBytes } from './__fixtures__/example-files';
import {
  buildProgram,
  consoleLinesOf,
  deadOffsetsOf,
  defaultListingOf,
  depthsOf,
  findListing,
  firstStepByLine,
  firstStepByOffset,
  isCurrentListing,
  lastLiveSnapshot,
  lineForOffset,
  lineMappingNote,
  listingFor,
  listingToShow,
  methodKeyOf,
  NO_SOURCE_LINES,
  offsetsForLine,
  previewProgram,
  runnableMethodsOf,
  runPrintedOutput,
  runSummaryOf,
  type LoadedProgram,
  type MethodListing,
} from './program';

const FACTORIAL_ENTRY = {
  id: 'factorial',
  title: 'Factorial: recursion',
  tagline: 'Five frames deep and back: 4! = 24.',
  description: 'Recursive 4! = 24.',
  classFile: 'Factorial.class',
  sourceFile: 'Factorial.java',
  entryMethod: 'main',
  resultVariable: 'result',
  expectedResult: 24,
} as const;

function factorialProgram(): LoadedProgram {
  return buildProgram({
    origin: { kind: 'example', entry: FACTORIAL_ENTRY },
    classFile: parseClassFile(readExampleBytes('Factorial.class')),
    source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
  });
}

function listing(program: LoadedProgram, name: string, descriptor: string): MethodListing {
  const found = findListing(program, name, descriptor);
  if (found === undefined) {
    throw new Error(`method ${name}${descriptor} is missing from the program`);
  }
  return found;
}

function syntheticMain(code: readonly number[]): ClassFile {
  return syntheticClass({
    methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code }],
  });
}

describe('buildProgram', () => {
  it('runs the class file and keeps the whole history', () => {
    const program = factorialProgram();

    expect(program.outcome.kind).toBe('completed');
    expect(program.snapshots).toHaveLength(40);
    expect(depthsOf(program.snapshots).reduce((a, b) => Math.max(a, b))).toBe(5);
  });

  it('disassembles every method with code, once', () => {
    const program = factorialProgram();

    expect(program.methods.map((method) => `${method.name}${method.descriptor}`)).toEqual([
      '<init>()V',
      'factorial(I)I',
      'main([Ljava/lang/String;)V',
    ]);
    expect(program.entry?.name).toBe('main');
    expect(listing(program, 'factorial', '(I)I').instructions[0]?.mnemonic).toBe('iload_0');
  });

  it('records the offsets the run reached, per method', () => {
    const program = factorialProgram();
    const factorial = listing(program, 'factorial', '(I)I');

    expect(deadOffsetsOf(factorial).size).toBe(0);
    const constructor = listing(program, '<init>', '()V');
    expect(constructor.executedOffsets.size).toBe(0);
    expect(deadOffsetsOf(constructor).size).toBe(constructor.instructions.length);
  });

  it('splits the source into lines and keeps the file name', () => {
    const program = factorialProgram();

    expect(program.sourceFileName).toBe('Factorial.java');
    expect(program.sourceLines[27]).toContain('int result = factorial(4);');
  });

  it('explains the missing source of an uploaded class file', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Factorial.class' },
      classFile: parseClassFile(readExampleBytes('Factorial.class')),
    });

    expect(program.sourceFileName).toBe('Factorial.class');
    expect(program.sourceLines).toBe(NO_SOURCE_LINES);
  });

  it('keeps the history collected before a VM error', () => {
    const program = buildProgram({
      classFile: syntheticMain([0x04, 0x03, 0x6c, 0xb1]),
      origin: { kind: 'upload', fileName: 'Divide.class' },
    });

    expect(program.outcome).toEqual({
      kind: 'vm-error',
      error: { kind: 'division-by-zero', offset: 2, methodName: 'main' },
    });
    expect(program.snapshots).toHaveLength(3);
  });

  it('keeps the history collected before the step limit', () => {
    const program = buildProgram({
      classFile: syntheticMain([0xa7, 0x00, 0x00]),
      origin: { kind: 'upload', fileName: 'Loop.class' },
      maxSteps: 50,
    });

    expect(program.outcome).toEqual({ kind: 'step-limit', limit: 50 });
    expect(program.snapshots).toHaveLength(50);
  });

  it('reports where decoding stopped', () => {
    const program = buildProgram({
      classFile: syntheticMain([0x03, 0xaa, 0x00, 0x00, 0x00]),
      origin: { kind: 'upload', fileName: 'Switch.class' },
    });

    expect(program.entry?.truncatedAtOffset).toBe(1);
    expect(program.entry?.instructions).toHaveLength(1);
  });
});

describe('method listing lookup', () => {
  it('follows the top frame of the snapshot', () => {
    const program = factorialProgram();
    const insideRecursion = program.snapshots[10];

    expect(listingFor(program, insideRecursion)?.name).toBe('factorial');
  });

  it('falls back to the entry method for the terminal snapshot', () => {
    const program = factorialProgram();
    const terminal = program.snapshots.at(-1);

    expect(terminal?.callStack).toHaveLength(0);
    expect(listingFor(program, terminal)?.name).toBe('main');
  });
});

describe('run summary', () => {
  it('reads the answer out of the frame the run left behind', () => {
    const summary = runSummaryOf(factorialProgram());

    expect(summary).toEqual({
      resultName: 'result',
      resultValue: 24,
      totalSteps: 40,
      maxDepth: 5,
      referenceValue: 24,
    });
  });

  it('withholds the reference value when the run disagrees with it', () => {
    const program = buildProgram({
      origin: { kind: 'example', entry: { ...FACTORIAL_ENTRY, expectedResult: 25 } },
      classFile: parseClassFile(readExampleBytes('Factorial.class')),
      source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
    });

    expect(runSummaryOf(program)?.resultValue).toBe(24);
    expect(runSummaryOf(program)?.referenceValue).toBeUndefined();
  });

  it('has nothing to summarise for a run that stopped early', () => {
    const program = buildProgram({
      classFile: syntheticMain([0xa7, 0x00, 0x00]),
      origin: { kind: 'upload', fileName: 'Loop.class' },
      maxSteps: 20,
    });

    expect(runSummaryOf(program)).toBeUndefined();
  });

  it('finds the last snapshot that still had a frame', () => {
    const program = factorialProgram();

    expect(program.snapshots.at(-1)?.callStack).toHaveLength(0);
    expect(lastLiveSnapshot(program.snapshots)?.step).toBe(38);
  });
});

describe('seeking by row', () => {
  it('maps every offset of a method to the first step that stood there', () => {
    const program = factorialProgram();
    const steps = firstStepByOffset(program.snapshots, listing(program, 'factorial', '(I)I'));

    expect(steps.get(0)).toBe(2);
    expect(program.snapshots[2]?.currentInstruction?.offset).toBe(0);
    expect(steps.get(11)).toBe(9);
    expect(program.snapshots[9]?.currentInstruction?.mnemonic).toBe('invokestatic');
  });

  it('keeps the methods apart, so an offset means one instruction', () => {
    const program = factorialProgram();
    const main = firstStepByOffset(
      program.snapshots,
      listing(program, 'main', '([Ljava/lang/String;)V'),
    );

    expect(main.get(0)).toBe(0);
    expect(main.size).toBe(4);
  });

  it('maps every source line to the first step that reached it', () => {
    const program = factorialProgram();
    const steps = firstStepByLine(program.snapshots);

    expect(steps.get(28)).toBe(0);
    expect(steps.get(17)).toBe(2);
  });
});

describe('run preview', () => {
  it('measures a run without keeping its history', () => {
    const preview = previewProgram(parseClassFile(readExampleBytes('Factorial.class')));

    expect(preview.steps).toBe(40);
    expect(preview.maxDepth).toBe(5);
    expect(preview.profile).toHaveLength(32);
    expect(Math.max(...preview.profile)).toBe(5);
  });
});

describe('line mapping', () => {
  it('picks the entry with the largest startPc <= offset', () => {
    const program = factorialProgram();
    const factorial = listing(program, 'factorial', '(I)I');

    const lines = factorial.instructions.map((instruction) =>
      lineForOffset(factorial, instruction.offset),
    );

    expect(lines[0]).toBe(17);
    expect(lines.at(-1)).toBe(20);
    expect(lineMappingNote(factorial, 7)).toBe('LineNumberTable · largest startPc ≤ 7 → line 20');
  });

  it('maps a source line back to the range of offsets that produced it', () => {
    const program = factorialProgram();
    const factorial = listing(program, 'factorial', '(I)I');

    expect(offsetsForLine(factorial, 17)).toEqual({ from: 0, to: 2 });
    expect(offsetsForLine(factorial, 1)).toBeUndefined();
  });
});

function libraryProgram(): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName: 'Library.class' },
    classFile: parseClassFile(readFixtureBytes('Library.class')),
  });
}

describe('a class with no method a run can start from', () => {
  it('is still a program: every method is listed, and no run was attempted', () => {
    const program = libraryProgram();

    expect(program.outcome).toEqual({ kind: 'no-entry-point' });
    expect(program.snapshots).toHaveLength(0);
    expect(program.methods.map(methodKeyOf)).toEqual(['<init>()V', 'twice(I)I', 'clamp(III)I']);
    expect(runnableMethodsOf(program)).toEqual([]);
  });

  it('says of each method why a run cannot start there', () => {
    const program = libraryProgram();

    expect(program.methods.map((method) => method.notRunnable)).toEqual([
      'instance-method',
      'descriptor',
      'descriptor',
    ]);
  });

  it('opens the panel on the first method there is anything to disassemble', () => {
    const program = libraryProgram();

    expect(program.entry).toBeUndefined();
    expect(defaultListingOf(program)?.name).toBe('<init>');
    expect(listingFor(program, undefined)?.name).toBe('<init>');
    expect(listingToShow(program, undefined, 'clamp(III)I')?.descriptor).toBe('(III)I');
  });

  it('falls back rather than blanking when the opened method is not in this class', () => {
    const program = libraryProgram();

    expect(listingToShow(program, undefined, 'gone()V')?.name).toBe('<init>');
  });

  it('lists a method with no Code attribute instead of hiding it', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Shape.class' },
      classFile: syntheticClass({
        methods: [
          { name: 'area', descriptor: '()I', accessFlags: AccessFlag.Abstract },
          { name: 'draw', descriptor: '()V', accessFlags: AccessFlag.Public, code: [0xb1] },
        ],
      }),
    });

    expect(program.methods.map((method) => method.notRunnable)).toEqual([
      'no-code',
      'instance-method',
    ]);
    expect(program.methods[0]?.instructions).toEqual([]);
    expect(defaultListingOf(program)?.name).toBe('draw');
  });
});

describe('entry points beyond main', () => {
  it('runs the only runnable method a class has, whatever it is called', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
    });

    expect(program.entry?.name).toBe('count');
    expect(program.outcome).toEqual({ kind: 'completed', returnValue: 15 });
    expect(runnableMethodsOf(program).map(methodKeyOf)).toEqual(['count()I']);
  });

  it('marks a method that would need argument values rather than offering it', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
    });

    expect(findListing(program, 'step', '(I)I')?.notRunnable).toBe('descriptor');
  });

  it('starts from the method the caller names', () => {
    const classFile = syntheticClass({
      methods: [
        { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb1] },
        { name: 'answer', descriptor: '()I', code: [0x05, 0xac] },
      ],
    });

    expect(buildProgram({ origin: UPLOAD, classFile }).entry?.name).toBe('main');
    const chosen = buildProgram({ origin: UPLOAD, classFile, entryMethod: 'answer' });
    expect(chosen.entry?.name).toBe('answer');
    expect(chosen.outcome).toEqual({ kind: 'completed', returnValue: 2 });
  });

  it('never opens on the class initialiser, but keeps it runnable on request', () => {
    const classFile = syntheticClass({
      methods: [
        { name: '<clinit>', descriptor: '()V', code: [0xb1] },
        { name: 'compute', descriptor: '()I', code: [0x04, 0xac] },
      ],
    });

    const program = buildProgram({ origin: UPLOAD, classFile });

    expect(program.entry?.name).toBe('compute');
    expect(runnableMethodsOf(program).map((method) => method.name)).toEqual([
      '<clinit>',
      'compute',
    ]);
    expect(buildProgram({ origin: UPLOAD, classFile, entryMethod: '<clinit>' }).entry?.name).toBe(
      '<clinit>',
    );
  });
});

const UPLOAD = { kind: 'upload', fileName: 'Synthetic.class' } as const;

describe('the listing the panels are looking at', () => {
  it('is live only while the step is standing in it', () => {
    const program = factorialProgram();
    const frame = program.snapshots[12]?.callStack.at(-1);

    expect(isCurrentListing(listing(program, 'factorial', '(I)I'), frame)).toBe(true);
    expect(isCurrentListing(listing(program, '<init>', '()V'), frame)).toBe(false);
    expect(isCurrentListing(undefined, frame)).toBe(false);
  });
});

describe('console output', () => {
  it('is empty for a run that printed nothing, and reports so for the whole run', () => {
    const program = factorialProgram();

    expect(consoleLinesOf(program.snapshots[0])).toEqual([]);
    expect(consoleLinesOf(undefined)).toEqual([]);
    expect(runPrintedOutput(program.snapshots)).toBe(false);
  });
});
