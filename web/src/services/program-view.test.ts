import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';

import { readExampleBytes, readExampleText } from './__fixtures__/example-files';
import { buildProgram, findListing, type LoadedProgram, type MethodListing } from './program';
import {
  historyViewOf,
  listingViewOf,
  mnemonicHelpFor,
  sourceLinesForOffsets,
  stepViewOf,
} from './program-view';

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

function listingOf(program: LoadedProgram, name: string, descriptor: string): MethodListing {
  const found = findListing(program, name, descriptor);
  if (found === undefined) {
    throw new Error(`method ${name}${descriptor} is missing from the program`);
  }
  return found;
}

const program = factorialProgram();
const main = listingOf(program, 'main', '([Ljava/lang/String;)V');
const factorial = listingOf(program, 'factorial', '(I)I');

describe('historyViewOf', () => {
  it('summarises the whole run once, without a step to look at', () => {
    const view = historyViewOf(program);

    expect(view.summary?.resultValue).toBe(24);
    expect(view.summary?.totalSteps).toBe(program.snapshots.length);
    expect(view.lastLive?.step).toBe(38);
    expect(view.printed).toBe(false);
    expect(view.timelineEvents.length).toBeGreaterThan(0);
    expect(view.stepForLine.size).toBeGreaterThan(0);
  });

  it('answers for a program that was never loaded', () => {
    const view = historyViewOf(undefined);

    expect(view.summary).toBeUndefined();
    expect(view.lastLive).toBeUndefined();
    expect(view.printed).toBe(false);
    expect(view.timelineEvents).toEqual([]);
    expect(view.stepForLine.size).toBe(0);
  });
});

describe('listingViewOf', () => {
  it('derives everything a listing needs, and nothing a step decides', () => {
    const view = listingViewOf(program, factorial);

    expect(view.mnemonicHelp.get('imul')).toMatch(/product/i);
    expect(view.sourceLineForOffset?.get(0)).toBe(factorial.lineNumbers[0]?.lineNumber);
    expect(view.comments?.size).toBeGreaterThan(0);
    expect(view.stepForOffset.get(0)).toBe(2);
    expect(view.deadOffsets).toBeInstanceOf(Set);
  });

  it('leaves the dead offsets out for a listing that was never entered', () => {
    const untouched: MethodListing = { ...factorial, executedOffsets: new Set() };

    expect(listingViewOf(program, untouched).deadOffsets).toBeUndefined();
  });

  it('answers for no listing at all', () => {
    const view = listingViewOf(program, undefined);

    expect(view.comments).toBeUndefined();
    expect(view.constructs).toBeUndefined();
    expect(view.sourceLineForOffset).toBeUndefined();
    expect(view.mnemonicHelp.size).toBe(0);
    expect(view.stepForOffset.size).toBe(0);
  });
});

describe('mnemonicHelpFor', () => {
  it('carries one entry per distinct mnemonic that has an explanation', () => {
    const help = mnemonicHelpFor(factorial);
    const mnemonics = new Set(factorial.instructions.map((instruction) => instruction.mnemonic));

    expect(help.size).toBeLessThanOrEqual(mnemonics.size);
    for (const mnemonic of help.keys()) {
      expect(mnemonics.has(mnemonic)).toBe(true);
    }
  });

  it('is empty without a listing', () => {
    expect(mnemonicHelpFor(undefined).size).toBe(0);
  });
});

describe('sourceLinesForOffsets', () => {
  it('maps every instruction offset that the line number table covers', () => {
    const lines = sourceLinesForOffsets(main);

    expect(lines?.size).toBe(main.instructions.length);
    expect(lines?.get(0)).toBe(main.lineNumbers[0]?.lineNumber);
  });
});

describe('stepViewOf', () => {
  it('describes the step against the listing that is executing', () => {
    const step = 12;
    const snapshot = program.snapshots[step];
    const view = stepViewOf(program, snapshot, factorial, false);

    expect(view.isLive).toBe(true);
    expect(view.topFrame?.methodName).toBe('factorial');
    expect(view.next?.explanation).toBeTypeOf('string');
    expect(view.mappingNote).toMatch(/LineNumberTable/);
    expect(view.consoleLines).toBeUndefined();
  });

  it('says nothing about the current instruction while another listing is on show', () => {
    const view = stepViewOf(program, program.snapshots[12], main, false);

    expect(view.isLive).toBe(false);
    expect(view.next).toBeUndefined();
    expect(view.mappingNote).toBeUndefined();
    expect(view.pcRange).toBeUndefined();
    expect(view.operandRoles).toBeDefined();
  });

  it('reads the console only for a run that printed something', () => {
    expect(stepViewOf(program, program.snapshots[0], main, true).consoleLines).toEqual([]);
    expect(stepViewOf(program, program.snapshots[0], main, false).consoleLines).toBeUndefined();
  });

  it('answers for a program that was never loaded', () => {
    const view = stepViewOf(undefined, undefined, undefined, false);

    expect(view.topFrame).toBeUndefined();
    expect(view.isLive).toBe(false);
    expect(view.next).toBeUndefined();
    expect(view.operandRoles).toBeUndefined();
  });
});
