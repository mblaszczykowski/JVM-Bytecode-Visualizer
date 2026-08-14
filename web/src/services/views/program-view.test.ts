import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile } from '../../core/classfile';
import { syntheticClass } from '../../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from '../__fixtures__/example-files';
import { buildProgram, type LoadedProgram, type MethodListing } from '../loading/program';
import {
  consoleLinesOf,
  findListing,
  firstStepByLine,
  firstStepByOffset,
  historyViewOf,
  isCurrentListing,
  lastLiveSnapshot,
  lineForOffset,
  lineMappingNote,
  listingFor,
  listingViewOf,
  methodKeyOf,
  mnemonicHelpFor,
  offsetsForLine,
  runPrintedOutput,
  runSummaryOf,
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

function syntheticMain(code: readonly number[]): ClassFile {
  return syntheticClass({
    methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code }],
  });
}

const UPLOAD = { kind: 'upload', fileName: 'Synthetic.class' } as const;

const program = factorialProgram();
const main = listingOf(program, 'main', '([Ljava/lang/String;)V');
const factorial = listingOf(program, 'factorial', '(I)I');

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
      reference: { expected: 24, matches: true },
    });
  });

  it('keeps the reference value and says the run disagrees with it', () => {
    const program = buildProgram({
      origin: { kind: 'example', entry: { ...FACTORIAL_ENTRY, expectedResult: 25 } },
      classFile: parseClassFile(readExampleBytes('Factorial.class')),
      source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
    });

    expect(runSummaryOf(program)?.resultValue).toBe(24);
    expect(runSummaryOf(program)?.reference).toEqual({ expected: 25, matches: false });
  });

  it('has no reference at all for a class file that came from outside the manifest', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Factorial.class' },
      classFile: parseClassFile(readExampleBytes('Factorial.class')),
    });

    expect(runSummaryOf(program)?.reference).toBeUndefined();
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
    const steps = firstStepByOffset(program.snapshots, listingOf(program, 'factorial', '(I)I'));

    expect(steps.get(0)).toBe(2);
    expect(program.snapshots[2]?.currentInstruction?.offset).toBe(0);
    expect(steps.get(11)).toBe(9);
    expect(program.snapshots[9]?.currentInstruction?.mnemonic).toBe('invokestatic');
  });

  it('keeps the methods apart, so an offset means one instruction', () => {
    const program = factorialProgram();
    const main = firstStepByOffset(
      program.snapshots,
      listingOf(program, 'main', '([Ljava/lang/String;)V'),
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

describe('line mapping', () => {
  it('picks the entry with the largest startPc <= offset', () => {
    const program = factorialProgram();
    const factorial = listingOf(program, 'factorial', '(I)I');

    const lines = factorial.instructions.map((instruction) =>
      lineForOffset(factorial, instruction.offset),
    );

    expect(lines[0]).toBe(17);
    expect(lines.at(-1)).toBe(20);
    expect(lineMappingNote(factorial, 7)).toBe('LineNumberTable · largest startPc ≤ 7 → line 20');
  });

  it('maps a source line back to the range of offsets that produced it', () => {
    const program = factorialProgram();
    const factorial = listingOf(program, 'factorial', '(I)I');

    expect(offsetsForLine(factorial, 17)).toEqual({ from: 0, to: 2 });
    expect(offsetsForLine(factorial, 1)).toBeUndefined();
  });

  it('reads a LineNumberTable the class file left out of order', () => {
    const shuffled = buildProgram({
      origin: UPLOAD,
      classFile: syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
            code: [0x03, 0x04, 0x05, 0x06, 0x57, 0x57, 0x57, 0xb1],
            lineNumberTable: [
              { startPc: 4, lineNumber: 9 },
              { startPc: 0, lineNumber: 7 },
              { startPc: 2, lineNumber: 8 },
            ],
          },
        ],
      }),
    });
    const main = listingOf(shuffled, 'main', '([Ljava/lang/String;)V');

    expect(offsetsForLine(main, 7)).toEqual({ from: 0, to: 1 });
    expect(offsetsForLine(main, 8)).toEqual({ from: 2, to: 3 });
    expect(offsetsForLine(main, 9)).toEqual({ from: 4, to: 7 });
  });

  it('agrees with the offset-by-offset mapping for every line of a real method', () => {
    const program = factorialProgram();

    for (const method of program.methods) {
      const lines = new Set(method.lineNumbers.map((entry) => entry.lineNumber));
      for (const line of lines) {
        const offsets = method.instructions
          .map((instruction) => instruction.offset)
          .filter((offset) => lineForOffset(method, offset) === line);

        expect(offsetsForLine(method, line), `${methodKeyOf(method)} line ${String(line)}`).toEqual(
          offsets.length === 0 ? undefined : { from: offsets[0], to: offsets.at(-1) },
        );
      }
    }
  });
});

describe('the listing the panels are looking at', () => {
  it('is live only while the step is standing in it', () => {
    const program = factorialProgram();
    const frame = program.snapshots[12]?.callStack.at(-1);

    expect(isCurrentListing(listingOf(program, 'factorial', '(I)I'), frame)).toBe(true);
    expect(isCurrentListing(listingOf(program, '<init>', '()V'), frame)).toBe(false);
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
