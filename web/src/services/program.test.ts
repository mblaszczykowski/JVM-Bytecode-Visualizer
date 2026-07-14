import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile } from '../core/classfile';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from './__fixtures__/example-files';
import {
  buildProgram,
  deadOffsetsOf,
  depthsOf,
  findListing,
  lineForOffset,
  lineMappingNote,
  listingFor,
  NO_SOURCE_LINES,
  offsetsForLine,
  type LoadedProgram,
  type MethodListing,
} from './program';

const FACTORIAL_ENTRY = {
  id: 'factorial',
  title: 'Factorial — recursion',
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

/** `main` executing `code`, with no source and no line table unless the test adds one. */
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

    // factorial(4) takes both branches, so nothing in it stays dead...
    expect(deadOffsetsOf(factorial).size).toBe(0);
    // ...while the constructor is never executed by the interpreter.
    const constructor = listing(program, '<init>', '()V');
    expect(constructor.executedOffsets.size).toBe(0);
    expect(deadOffsetsOf(constructor).size).toBe(constructor.instructions.length);
  });

  it('splits the source into lines and keeps the file name', () => {
    const program = factorialProgram();

    expect(program.sourceFileName).toBe('Factorial.java');
    expect(program.sourceLines[36]).toContain('int result = factorial(4);');
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
    // iconst_1, iconst_0, idiv, return
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
    // goto 0 — an unconditional loop back onto itself.
    const program = buildProgram({
      classFile: syntheticMain([0xa7, 0x00, 0x00]),
      origin: { kind: 'upload', fileName: 'Loop.class' },
      maxSteps: 50,
    });

    expect(program.outcome).toEqual({ kind: 'step-limit', limit: 50 });
    expect(program.snapshots).toHaveLength(50);
  });

  it('reports where decoding stopped', () => {
    // iconst_0, tableswitch — variable length, so the rest of the method is undecodable.
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

describe('line mapping', () => {
  it('picks the entry with the largest startPc <= offset', () => {
    const program = factorialProgram();
    const factorial = listing(program, 'factorial', '(I)I');

    const lines = factorial.instructions.map((instruction) =>
      lineForOffset(factorial, instruction.offset),
    );

    expect(lines[0]).toBe(26);
    expect(lines.at(-1)).toBe(29);
    expect(lineMappingNote(factorial, 7)).toBe('LineNumberTable · largest startPc ≤ 7 → line 29');
  });

  it('maps a source line back to the range of offsets that produced it', () => {
    const program = factorialProgram();
    const factorial = listing(program, 'factorial', '(I)I');

    expect(offsetsForLine(factorial, 26)).toEqual({ from: 0, to: 2 });
    expect(offsetsForLine(factorial, 1)).toBeUndefined();
  });
});
