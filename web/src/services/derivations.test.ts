import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import type { Snapshot } from '../core/interpreter';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from './__fixtures__/example-files';
import {
  constantPoolComments,
  constantPoolIndexOf,
  describeNextInstruction,
  describeOperandRoles,
  explainMnemonic,
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
  const snapshot = firstSnapshotOf(program, mnemonic);
  const summary = describeNextInstruction(
    snapshot,
    listingFor(program, snapshot),
    program.classFile,
  );
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
      'Pops 4 and calls factorial(I)I with it in slot 0 — the callee starts at pc 0 and ' +
        'main resumes at pc 4.',
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
    // `result` only enters scope at the instruction after the store (LocalVariableTable
    // start_pc 5), and the store is what puts it there — so it is named, not numbered.
    expect(summaryOf(program, 'istore_1').explanation).toBe('Pops 24 into local slot 1 (result).');
  });

  it('spells out a comparison and its branch target', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'if_icmpgt').explanation).toBe(
      'Pops both values and compares 4 > 1 — true, so execution jumps to pc 7.',
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

    expect(
      describeNextInstruction(terminalSnapshot(program), program.entry, program.classFile),
    ).toBeUndefined();
  });

  it('says the operands are unknown rather than printing "undefined"', () => {
    // if_icmpgt on an empty stack: the snapshot precedes the underflow that stops the run.
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Underflow.class' },
      classFile: syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
            // if_icmpgt +4, nop, return
            code: [0xa3, 0x00, 0x04, 0x00, 0xb1],
          },
        ],
      }),
    });

    const { explanation } = summaryOf(program, 'if_icmpgt');

    expect(explanation).not.toContain('undefined');
    expect(explanation).toBe(
      'Pops both values and compares the top value > the top value; a true comparison jumps ' +
        'to pc 4, otherwise execution falls through.',
    );
  });

  it('warns that an unsupported instruction ends the run', () => {
    // monitorenter — decoded, listed, outside the executable subset.
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Unsupported.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xc2] }],
      }),
    });

    const summary = summaryOf(program, 'monitorenter');

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

  it('names the two operands of a binary instruction by position', () => {
    const program = factorialProgram();
    const snapshot = firstSnapshotOf(program, 'if_icmpgt');

    const roles = describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);

    // Two cells both reading "→ operand" would hide the one thing that matters here: which
    // side of `4 > 1` each value is.
    expect(roles).toEqual(['→ left', '→ right']);
  });

  it('names a single operand after the instruction about to take it', () => {
    const program = factorialProgram();
    const snapshot = firstSnapshotOf(program, 'istore_1');

    const roles = describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);

    expect(roles).toEqual(['→ istore_1']);
  });

  it('follows an unconditional jump instead of blaming the instruction below it', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Jump.class' },
      classFile: syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
            // 0: iconst_1, 1: iconst_2, 2: goto +6 → 8, 5: imul (never reached),
            // 6: pop, 7: nop, 8: iadd, 9: pop, 10: return
            code: [0x04, 0x05, 0xa7, 0x00, 0x06, 0x68, 0x57, 0x00, 0x60, 0x57, 0xb1],
          },
        ],
      }),
    });
    const snapshot = firstSnapshotOf(program, 'goto');

    const roles = describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);

    // `imul` sits right after the jump in the listing, but the run never arrives there.
    expect(roles).toEqual([undefined, 'waiting for iadd']);
  });

  it('has no roles to report on the terminal snapshot', () => {
    const program = factorialProgram();

    expect(
      describeOperandRoles(terminalSnapshot(program), program.entry, program.classFile),
    ).toEqual([]);
  });
});

describe('array instructions', () => {
  /**
   * `int[] a = new int[3]; a[1] = 7; int v = a[1]; int n = a.length;` — one pass through
   * every heap instruction, with the values the explanations have to quote.
   */
  const ARRAY_PROGRAM = [
    0x06, //          0: iconst_3
    0xbc,
    0x0a, //   1: newarray int
    0x4c, //          3: astore_1
    0x2b, //          4: aload_1
    0x04, //          5: iconst_1
    0x10,
    0x07, //    6: bipush 7
    0x4f, //          8: iastore
    0x2b, //          9: aload_1
    0x04, //         10: iconst_1
    0x2e, //         11: iaload
    0x3d, //         12: istore_2
    0x2b, //         13: aload_1
    0xbe, //         14: arraylength
    0x3e, //         15: istore_3
    0xb1, //         16: return
  ];

  function arrayProgram(code: readonly number[] = ARRAY_PROGRAM): LoadedProgram {
    return buildProgram({
      origin: { kind: 'upload', fileName: 'Arrays.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code, maxLocals: 4 }],
      }),
    });
  }

  it('names the array and the length an allocation is about to produce', () => {
    const program = arrayProgram();

    expect(summaryOf(program, 'newarray').explanation).toBe(
      'Allocates int[3], zero-filled, and pushes a reference to it.',
    );
    expect(summaryOf(program, 'newarray').effects).toEqual([
      { label: 'pop 1' },
      { label: 'push ref' },
    ]);
  });

  it('spells a store out as the value, the index and the array it lands in', () => {
    const program = arrayProgram();

    expect(summaryOf(program, 'iastore').explanation).toBe('Stores 7 at index 1 of int[3].');
    expect(summaryOf(program, 'iastore').effects).toEqual([{ label: 'pop 3' }]);
  });

  it('reads the element a load is about to push out of the heap of the snapshot', () => {
    const program = arrayProgram();

    expect(summaryOf(program, 'iaload').explanation).toBe(
      'Pushes 7, the element at index 1 of int[3].',
    );
    expect(summaryOf(program, 'arraylength').explanation).toBe(
      'Pops the reference to int[3] and pushes its length, 3.',
    );
  });

  it('describes a reference slot by the array it names rather than by its handle', () => {
    const program = arrayProgram();

    expect(summaryOf(program, 'aload_1').explanation).toBe(
      'Pushes the reference in local 1 (slot 1 = int[3]) onto the operand stack.',
    );
    expect(summaryOf(program, 'astore_1').explanation).toBe(
      'Pops the reference to int[3] into local slot 1 (slot 1).',
    );
    expect(summaryOf(program, 'aload_1').effects).toEqual([{ label: 'push ref' }]);
  });

  it('calls a null reference null instead of printing the handle behind it', () => {
    // aconst_null; astore_1; aload_1; arraylength; istore_2; return
    const program = arrayProgram([0x01, 0x4c, 0x2b, 0xbe, 0x3d, 0xb1]);

    expect(summaryOf(program, 'aconst_null').explanation).toBe(
      'Pushes the null reference onto the operand stack.',
    );
    expect(summaryOf(program, 'aload_1').explanation).toBe(
      'Pushes the reference in local 1 (slot 1 = null) onto the operand stack.',
    );
    expect(summaryOf(program, 'arraylength').explanation).toBe(
      'Pops an array reference and pushes the length of the array.',
    );
  });

  it('warns when an access is about to leave the array', () => {
    // iconst_1; newarray int; astore_1; aload_1; iconst_3; iaload; istore_2; return
    const program = arrayProgram([0x04, 0xbc, 0x0a, 0x4c, 0x2b, 0x06, 0x2e, 0x3d, 0xb1]);

    expect(summaryOf(program, 'iaload').explanation).toBe(
      'Reads index 3 of int[1] — outside the array, which stops the run with an ' +
        'ArrayIndexOutOfBoundsException.',
    );
  });

  it('says an element type outside the int heap ends the run', () => {
    // iconst_1; newarray long; astore_1; return
    const program = arrayProgram([0x04, 0xbc, 0x0b, 0x4c, 0xb1]);

    expect(summaryOf(program, 'newarray').explanation).toBe(
      'Allocates long[] — this interpreter only allocates int arrays, so running it stops ' +
        'the program here.',
    );
  });

  it('labels each operand cell by what the array instruction does with it', () => {
    const program = arrayProgram();
    const rolesAt = (mnemonic: string): readonly (string | undefined)[] => {
      const snapshot = firstSnapshotOf(program, mnemonic);
      return describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);
    };

    // Bottom to top, which is the JVMS operand order: `…, arrayref, index, value`.
    expect(rolesAt('iastore')).toEqual(['→ array', '→ index', '→ value']);
    expect(rolesAt('iaload')).toEqual(['→ array', '→ index']);
    expect(rolesAt('arraylength')).toEqual(['→ array']);
    expect(rolesAt('newarray')).toEqual(['→ length']);
  });

  it('has a tooltip for every array mnemonic, run or not', () => {
    for (const mnemonic of [
      'aconst_null',
      'aload',
      'aload_0',
      'astore',
      'astore_2',
      'newarray',
      'arraylength',
      'iaload',
      'iastore',
    ]) {
      expect(explainMnemonic(mnemonic), mnemonic).toBeDefined();
    }
    expect(explainMnemonic('aload_0')).toBe(
      'Pushes the reference in local variable slot 0 onto the operand stack.',
    );
    expect(explainMnemonic('iload_0')).toBe('Pushes local variable slot 0 onto the operand stack.');
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

  it('names the pool entry of an instruction the interpreter cannot run', () => {
    // Reading a class file is not executing it: `getfield` is outside the executable subset,
    // and its listing still has to resolve `#7` the way javap does.
    expect(
      constantPoolIndexOf({ offset: 0, opcode: 0xb4, mnemonic: 'getfield', operands: [7] }),
    ).toBe(7);
    expect(constantPoolIndexOf({ offset: 0, opcode: 0xbb, mnemonic: 'new', operands: [2] })).toBe(
      2,
    );
  });

  it('has no pool entry for an instruction whose operand is not one', () => {
    expect(
      constantPoolIndexOf({ offset: 0, opcode: 0x15, mnemonic: 'iload', operands: [3] }),
    ).toBeUndefined();
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
