import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import type { Snapshot } from '../core/interpreter';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from './__fixtures__/example-files';
import {
  constantPoolComments,
  describeNextInstruction,
  describeOperandRoles,
  resolveConstant,
  stackDeltaOf,
} from './derivations';
import { buildProgram, findListing, listingFor, type LoadedProgram } from './program';

function factorialProgram(): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName: 'Factorial.class' },
    classFile: parseClassFile(readExampleBytes('Factorial.class')),
    source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
  });
}

/** First snapshot of the run whose next instruction is `mnemonic`. */
function firstSnapshotOf(program: LoadedProgram, mnemonic: string): Snapshot {
  const snapshot = program.snapshots.find(
    (candidate) => candidate.currentInstruction?.mnemonic === mnemonic,
  );
  if (snapshot === undefined) {
    throw new Error(`no snapshot executes ${mnemonic}`);
  }
  return snapshot;
}

function terminalSnapshot(program: LoadedProgram): Snapshot {
  const terminal = program.snapshots.at(-1);
  if (terminal === undefined) {
    throw new Error('the run produced no snapshots');
  }
  return terminal;
}

function summaryOf(program: LoadedProgram, mnemonic: string) {
  const summary = describeNextInstruction(firstSnapshotOf(program, mnemonic), program.classFile);
  if (summary === undefined) {
    throw new Error(`no summary for ${mnemonic}`);
  }
  return summary;
}

describe('next instruction summary', () => {
  it('reads the stack effect out of the opcode table', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'iconst_4').effects).toEqual([{ label: 'push int' }]);
    expect(summaryOf(program, 'imul').effects).toEqual([{ label: 'pop 2' }, { label: 'push int' }]);
    expect(summaryOf(program, 'ireturn').effects).toEqual([
      { label: 'pop 1' },
      { label: 'pop frame' },
      { label: 'push int' },
    ]);
  });

  it('derives the argument count of a call from the descriptor in the constant pool', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'invokestatic').effects).toEqual([
      { label: 'pop 1' },
      { label: 'push frame' },
    ]);
  });

  it('explains a call with the values it will consume', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'invokestatic').explanation).toBe(
      'Pops 4 and calls factorial(I)I with it in slot 0.',
    );
  });

  it('explains arithmetic with the concrete result', () => {
    const program = factorialProgram();

    // The first imul multiplies the base case 1 by n = 2 on the way out of the recursion.
    expect(summaryOf(program, 'imul').explanation).toBe('Pops 1 and 2 and pushes 2 × 1 = 2.');
  });

  it('names the local variable a load or store touches', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'iload_0').explanation).toBe(
      'Pushes local 0 (n = 4) onto the operand stack.',
    );
    // `result` enters scope at the pc the store jumps to (LocalVariableTable start_pc 5), so
    // at the store itself slot 1 still has no name of its own.
    expect(summaryOf(program, 'istore_1').explanation).toBe('Pops 24 into local slot 1 (slot 1).');
  });

  it('spells out a comparison and its branch target', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'if_icmpgt').explanation).toBe(
      'Pops both values and jumps to pc 7 when 4 > 1; otherwise falls through.',
    );
  });

  it('resolves the constant pool reference down to the method it names', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'invokestatic').cpChain).toEqual([
      '#7',
      'Methodref',
      'Factorial.factorial:(I)I',
    ]);
  });

  it('leaves out the chain for instructions without a constant pool operand', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'iconst_4').cpChain).toBeUndefined();
  });

  it('has nothing to say about the terminal snapshot', () => {
    const program = factorialProgram();

    expect(describeNextInstruction(terminalSnapshot(program), program.classFile)).toBeUndefined();
  });

  it('warns that an unsupported instruction ends the run', () => {
    // invokevirtual #1 — decoded, listed, never executable.
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Unsupported.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb6, 0x00, 0x01] }],
      }),
    });

    const summary = summaryOf(program, 'invokevirtual');

    expect(summary.effects).toEqual([]);
    expect(summary.explanation).toContain('outside the supported instruction subset');
    expect(summary.cpChain).toBeUndefined();
  });
});

describe('operand stack roles', () => {
  it('labels the arguments of a call and the value waiting behind it', () => {
    const program = factorialProgram();
    const snapshot = program.snapshots.find(
      (candidate) =>
        candidate.currentInstruction?.mnemonic === 'invokestatic' && candidate.callStack.length > 1,
    );
    if (snapshot === undefined) {
      throw new Error('the recursion never calls back into factorial');
    }

    const roles = describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);

    expect(roles).toEqual(['waiting for imul', '→ arg 0']);
  });

  it('has no roles to report on the terminal snapshot', () => {
    const program = factorialProgram();

    expect(
      describeOperandRoles(terminalSnapshot(program), program.entry, program.classFile),
    ).toEqual([]);
  });
});

describe('constant pool', () => {
  it('comments every instruction that names a pool entry, javap style', () => {
    const program = factorialProgram();
    const main = findListing(program, 'main', '([Ljava/lang/String;)V');
    if (main === undefined) {
      throw new Error('main is missing');
    }

    const comments = constantPoolComments(main, program.classFile);

    expect([...comments.values()]).toEqual(['// Method Factorial.factorial:(I)I']);
  });

  it('resolves a Class entry to its internal name', () => {
    const program = factorialProgram();
    const pool = program.classFile.constantPool;
    const classIndex = pool.findIndex((entry) => entry?.tag === 7);

    expect(resolveConstant(pool, classIndex)?.tagName).toBe('Class');
    expect(resolveConstant(pool, classIndex)?.chain).toHaveLength(3);
  });

  it('returns nothing for an index outside the pool', () => {
    const program = factorialProgram();

    expect(resolveConstant(program.classFile.constantPool, 9999)).toBeUndefined();
  });
});

describe('stack delta', () => {
  it('is unknown for instructions the interpreter cannot run', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Unsupported.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb6, 0x00, 0x01] }],
      }),
    });
    const instruction = program.entry?.instructions[0];

    expect(instruction).toBeDefined();
    expect(
      instruction === undefined
        ? undefined
        : stackDeltaOf(instruction, program.classFile.constantPool),
    ).toBeUndefined();
  });
});
