import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile } from '../../core/classfile';
import { syntheticClass } from '../../core/interpreter/__fixtures__/synthetic-class';
import type { RunCommand } from '../../workers/run-protocol';

import { AccessFlag } from '../../core/classfile';

import { readExampleBytes, readExampleText, readFixtureBytes } from '../__fixtures__/example-files';
import {
  buildProgram,
  depthsOf,
  describeNotRunnable,
  NO_SOURCE_LINES,
  previewProgram,
  PREVIEW_MAX_STEPS,
  type LoadedProgram,
  type MethodListing,
} from './program';
import { inlineRunner, type ProgramRunner } from './program-runner';
import {
  deadOffsetsOf,
  defaultListingOf,
  findListing,
  listingFor,
  listingToShow,
  methodKeyOf,
} from '../views/program-view';

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

function runnableOf(program: LoadedProgram): readonly MethodListing[] {
  return program.methods.filter((method) => method.notRunnable === undefined);
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

    expect(program.entry?.undecodedFromOffset).toBe(1);
    expect(program.entry?.instructions).toHaveLength(1);
  });
});

describe('run preview', () => {
  it('measures a run without keeping its history', async () => {
    const preview = await previewProgram(parseClassFile(readExampleBytes('Factorial.class')), {
      runner: inlineRunner,
    });

    expect(preview.steps).toBe(40);
    expect(preview.maxDepth).toBe(5);
    expect(preview.profile).toHaveLength(32);
    expect(Math.max(...preview.profile)).toBe(5);
  });

  it('hands the run to the runner rather than executing it here', async () => {
    const commands: RunCommand[] = [];
    const runner: ProgramRunner = {
      cancellable: true,
      run(command, options) {
        commands.push(command);
        return inlineRunner.run(command, options);
      },
    };

    await previewProgram(parseClassFile(readExampleBytes('Factorial.class')), { runner });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.entryMethod).toBe('main');
    expect(commands[0]?.entryDescriptor).toBe('([Ljava/lang/String;)V');
    expect(commands[0]?.maxSteps).toBe(PREVIEW_MAX_STEPS);
  });

  it('measures an empty run for a class with no entry point to start from', async () => {
    const preview = await previewProgram(
      syntheticClass({
        methods: [
          { name: 'area', descriptor: '()I', accessFlags: AccessFlag.Abstract },
          { name: 'draw', descriptor: '()V', accessFlags: AccessFlag.Public, code: [0xb1] },
        ],
      }),
      { runner: inlineRunner },
    );

    expect(preview.steps).toBe(0);
    expect(preview.maxDepth).toBe(0);
    expect(preview.profile).toEqual(Array.from({ length: 32 }, () => 0));
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
    expect(runnableOf(program)).toEqual([]);
  });

  it('says of each method why a run cannot start there', () => {
    const program = libraryProgram();

    expect(program.methods.map((method) => method.notRunnable)).toEqual([
      'instance-method',
      'not-an-entry-shape',
      'not-an-entry-shape',
    ]);
  });

  it('marks every shape a run cannot start from, whatever makes it unstartable', () => {
    const program = buildProgram({
      origin: UPLOAD,
      classFile: syntheticClass({
        methods: [
          { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb1] },
          { name: 'twice', descriptor: '(I)I', code: [0x1a, 0x1a, 0x60, 0xac] },
          { name: 'half', descriptor: '()D', code: [0x0e, 0xaf] },
          { name: 'join', descriptor: '([Ljava/lang/String;)Ljava/lang/String;', code: [0xb0] },
        ],
      }),
    });

    expect(program.methods.map((method) => method.notRunnable)).toEqual([
      undefined,
      'not-an-entry-shape',
      'not-an-entry-shape',
      'not-an-entry-shape',
    ]);
  });

  it('does not call an int method outside the subset the run itself executes', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'DaysInYear.class' },
      classFile: parseClassFile(readExampleBytes('DaysInYear.class')),
    });
    const daysInMonth = listing(program, 'daysInMonth', '(I)I');

    expect(daysInMonth.notRunnable).toBe('not-an-entry-shape');
    expect(daysInMonth.executedOffsets.size).toBeGreaterThan(0);
    expect(describeNotRunnable('not-an-entry-shape')).toBe(
      'a run starts from main(String[]), or from a method taking nothing and returning void or int',
    );
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
    expect(runnableOf(program).map(methodKeyOf)).toEqual(['count()I']);
  });

  it('marks a method that would need argument values rather than offering it', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Counter.class' },
      classFile: parseClassFile(readFixtureBytes('Counter.class')),
    });

    expect(findListing(program, 'step', '(I)I')?.notRunnable).toBe('not-an-entry-shape');
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

  it('runs the overload the descriptor names, not the first of that name', () => {
    const classFile = syntheticClass({
      methods: [
        { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb1] },
        { name: 'main', descriptor: '()I', code: [0x08, 0xac] },
      ],
    });

    const byName = buildProgram({ origin: UPLOAD, classFile, entryMethod: 'main' });
    const byDescriptor = buildProgram({
      origin: UPLOAD,
      classFile,
      entryMethod: 'main',
      entryDescriptor: '()I',
    });

    expect(byName.entry?.descriptor).toBe('([Ljava/lang/String;)V');
    expect(byDescriptor.entry?.descriptor).toBe('()I');
    expect(byDescriptor.outcome).toEqual({ kind: 'completed', returnValue: 5 });
  });

  it('refuses a named method a run cannot start from, rather than quietly running main', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Gcd.class' },
      classFile: parseClassFile(readExampleBytes('Gcd.class')),
      entryMethod: 'gcd',
      entryDescriptor: '(II)I',
    });

    expect(program.entry).toBeUndefined();
    expect(program.outcome).toEqual({ kind: 'no-entry-point' });
    expect(program.snapshots).toHaveLength(0);
  });

  it('refuses a name no method in the class carries', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Gcd.class' },
      classFile: parseClassFile(readExampleBytes('Gcd.class')),
      entryMethod: 'nowhere',
    });

    expect(program.entry).toBeUndefined();
    expect(program.outcome).toEqual({ kind: 'no-entry-point' });
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
    expect(runnableOf(program).map((method) => method.name)).toEqual(['<clinit>', 'compute']);
    expect(buildProgram({ origin: UPLOAD, classFile, entryMethod: '<clinit>' }).entry?.name).toBe(
      '<clinit>',
    );
  });
});

const UPLOAD = { kind: 'upload', fileName: 'Synthetic.class' } as const;
