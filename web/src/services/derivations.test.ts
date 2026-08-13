import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { lookupOpcode, T_INT, type OperandSpec } from '../core/disassembler';
import { WIDENED_FORMS } from '../core/disassembler/opcodes';
import {
  EXECUTABLE_OPCODES,
  type ExternalValue,
  type HeapObject,
  type Snapshot,
  type StackFrame,
  type ValueKind,
} from '../core/interpreter';
import {
  ConstantPoolBuilder,
  syntheticClass,
} from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readExampleText } from './__fixtures__/example-files';
import {
  baseMnemonicOf,
  describeNextInstruction,
  describeOperandRoles,
  describeValue,
  explainMnemonic,
  OPCODE_NOTES,
  OPERAND_ADDRESSING,
  stackDeltaOf,
} from './derivations';
import { buildProgram, listingFor, type LoadedProgram } from './program';

function factorialProgram(): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName: 'Factorial.class' },
    classFile: parseClassFile(readExampleBytes('Factorial.class')),
    source: { fileName: 'Factorial.java', text: readExampleText('Factorial.java') },
  });
}

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
      'Pops 4 and calls factorial(I)I with it in slot 0. The callee starts at pc 0 and ' +
        'main resumes at pc 4.',
    );
  });

  it('explains arithmetic with the concrete result', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'imul').explanation).toBe('Pops 1 and 2 and pushes 2 × 1 = 2.');
  });

  it('names the local variable a load or store touches', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'iload_0').explanation).toBe(
      'Pushes local 0 (n = 4) onto the operand stack.',
    );
    expect(summaryOf(program, 'istore_1').explanation).toBe('Pops 24 into local slot 1 (result).');
  });

  it('counts a negative increment down rather than up', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Countdown.class' },
      classFile: syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
            code: [0x05, 0x3b, 0x84, 0x00, 0xff, 0xb1],
          },
        ],
      }),
    });

    expect(summaryOf(program, 'iinc').explanation).toBe(
      'Subtracts 1 from local 0 (slot 0 = 2) in place, without touching the operand stack.',
    );
  });

  it('spells out a comparison and its branch target', () => {
    const program = factorialProgram();

    expect(summaryOf(program, 'if_icmpgt').explanation).toBe(
      'Pops both values and compares 4 > 1: true, so execution jumps to pc 7.',
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
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Underflow.class' },
      classFile: syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '([Ljava/lang/String;)V',
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
            code: [0x04, 0x05, 0xa7, 0x00, 0x06, 0x68, 0x57, 0x00, 0x60, 0x57, 0xb1],
          },
        ],
      }),
    });
    const snapshot = firstSnapshotOf(program, 'goto');

    const roles = describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);

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
  const ARRAY_PROGRAM = [
    0x06, 0xbc, 0x0a, 0x4c, 0x2b, 0x04, 0x10, 0x07, 0x4f, 0x2b, 0x04, 0x2e, 0x3d, 0x2b, 0xbe, 0x3e,
    0xb1,
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
      'Pushes the reference in local 1 (slot 1 = int[3]@0) onto the operand stack.',
    );
    expect(summaryOf(program, 'astore_1').explanation).toBe(
      'Pops the reference to int[3]@0 into local slot 1 (slot 1).',
    );
    expect(summaryOf(program, 'aload_1').effects).toEqual([{ label: 'push ref' }]);
  });

  it('calls a null reference null instead of printing the handle behind it', () => {
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
    const program = arrayProgram([0x04, 0xbc, 0x0a, 0x4c, 0x2b, 0x06, 0x2e, 0x3d, 0xb1]);

    expect(summaryOf(program, 'iaload').explanation).toBe(
      'Reads index 3 of int[1]: outside the array, which stops the run with an ' +
        'ArrayIndexOutOfBoundsException.',
    );
  });

  it('says an element type outside the int heap ends the run', () => {
    const program = arrayProgram([0x04, 0xbc, 0x0b, 0x4c, 0xb1]);

    expect(summaryOf(program, 'newarray').explanation).toBe(
      'Allocates long[]. This interpreter only allocates int arrays, so running it stops ' +
        'the program here.',
    );
  });

  it('labels each operand cell by what the array instruction does with it', () => {
    const program = arrayProgram();
    const rolesAt = (mnemonic: string): readonly (string | undefined)[] => {
      const snapshot = firstSnapshotOf(program, mnemonic);
      return describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile);
    };

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

describe('stack delta', () => {
  it('is unknown for instructions the interpreter cannot run', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Unsupported.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xc2] }],
      }),
    });
    const instruction = program.entry?.instructions[0];

    expect(instruction?.mnemonic).toBe('monitorenter');
    expect(
      instruction === undefined
        ? undefined
        : stackDeltaOf(instruction, program.classFile.constantPool),
    ).toBeUndefined();
  });

  it('is unknown when the constant pool does not name the member the call needs', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Broken.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb6, 0x00, 0x01] }],
      }),
    });
    const instruction = program.entry?.instructions[0];

    expect(instruction?.mnemonic).toBe('invokevirtual');
    expect(
      instruction === undefined
        ? undefined
        : stackDeltaOf(instruction, program.classFile.constantPool),
    ).toBeUndefined();
  });

  it('counts a long as the two operand stack slots it occupies', () => {
    const pool = new ConstantPoolBuilder();
    const fieldref = pool.fieldref('Synthetic', 'total', 'J');
    const methodref = pool.methodref('Synthetic', 'add', '(JI)J');
    const classFile = syntheticClass({
      pool,
      methods: [
        {
          name: 'main',
          descriptor: '([Ljava/lang/String;)V',
          code: [0xb2, 0x00, fieldref, 0xb8, 0x00, methodref],
        },
      ],
    });
    const program = buildProgram({ origin: { kind: 'upload', fileName: 'Wide.class' }, classFile });
    const [read, call] = program.entry?.instructions ?? [];

    expect(read && stackDeltaOf(read, classFile.constantPool)).toEqual({ pops: 0, pushes: 2 });
    expect(call && stackDeltaOf(call, classFile.constantPool)).toEqual({ pops: 3, pushes: 2 });
  });

  it('stays unknown while the field descriptor is out of reach', () => {
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'NoPool.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0xb2, 0x00, 0x02] }],
      }),
    });
    const instruction = program.entry?.instructions[0];

    expect(instruction?.mnemonic).toBe('getstatic');
    expect(
      instruction === undefined
        ? undefined
        : stackDeltaOf(instruction, program.classFile.constantPool),
    ).toBeUndefined();
  });

  it('counts the receiver of an instance call alongside its arguments', () => {
    const pool = new ConstantPoolBuilder();
    const methodref = pool.methodref('Synthetic', 'add', '(II)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        {
          name: 'main',
          descriptor: '([Ljava/lang/String;)V',
          code: [0xb6, 0x00, methodref, 0xb8, 0x00, methodref],
        },
      ],
    });
    const program = buildProgram({
      origin: { kind: 'upload', fileName: 'Calls.class' },
      classFile,
    });
    const [virtual, staticCall] = program.entry?.instructions ?? [];

    expect(virtual && stackDeltaOf(virtual, classFile.constantPool)).toEqual({
      pops: 3,
      pushes: 1,
    });
    expect(staticCall && stackDeltaOf(staticCall, classFile.constantPool)).toEqual({
      pops: 2,
      pushes: 1,
    });
  });
});

describe('reference instructions', () => {
  function referenceProgram(code: readonly number[]): LoadedProgram {
    return buildProgram({
      origin: { kind: 'upload', fileName: 'References.class' },
      classFile: syntheticClass({
        methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code, maxLocals: 4 }],
      }),
    });
  }

  it('compares references against null rather than against an integer zero', () => {
    const program = referenceProgram([0x01, 0xc6, 0x00, 0x03, 0xb1]);

    expect(summaryOf(program, 'ifnull').effects).toEqual([{ label: 'pop 1' }]);
    expect(summaryOf(program, 'ifnull').explanation).toBe(
      'Pops the top reference (null) and compares it against null: true, so execution jumps to pc 4.',
    );
  });

  it('reads a non-null test through the object the reference names', () => {
    const program = referenceProgram([0x04, 0xbc, 0x0a, 0xc7, 0x00, 0x03, 0xb1]);

    expect(summaryOf(program, 'ifnonnull').explanation).toBe(
      'Pops the top reference (int[1]@0) and compares it against null: true, so execution jumps to pc 6.',
    );
  });

  it('compares two references by identity, popping both', () => {
    const program = referenceProgram([0x01, 0x01, 0xa5, 0x00, 0x03, 0xb1]);

    expect(summaryOf(program, 'if_acmpeq').effects).toEqual([{ label: 'pop 2' }]);
    expect(summaryOf(program, 'if_acmpeq').explanation).toBe(
      'Pops both references and checks whether null and null are the same object: true, so ' +
        'execution jumps to pc 5.',
    );
  });

  it('labels the operands of a reference comparison', () => {
    const program = referenceProgram([0x01, 0x01, 0xa5, 0x00, 0x03, 0xb1]);
    const snapshot = firstSnapshotOf(program, 'if_acmpeq');

    expect(
      describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile),
    ).toEqual(['→ left', '→ right']);
  });
});

describe('printing to the console', () => {
  function collatzProgram(): LoadedProgram {
    return buildProgram({
      origin: { kind: 'upload', fileName: 'Collatz.class' },
      classFile: parseClassFile(readExampleBytes('Collatz.class')),
      source: { fileName: 'Collatz.java', text: readExampleText('Collatz.java') },
    });
  }

  it('says what getstatic pushes instead of calling it an int', () => {
    const program = collatzProgram();

    expect(summaryOf(program, 'getstatic').effects).toEqual([{ label: 'push ref' }]);
    expect(summaryOf(program, 'getstatic').explanation).toBe(
      'Pushes a reference to System.out onto the operand stack.',
    );
  });

  it('names the receiver and the argument the call is about to hand over', () => {
    const program = collatzProgram();

    expect(summaryOf(program, 'invokevirtual').effects).toEqual([{ label: 'pop 2' }]);
    expect(summaryOf(program, 'invokevirtual').explanation).toBe(
      'Pops 7 and the receiver System.out and calls java/io/PrintStream.println(I)V, one of the ' +
        'few standard-library methods this machine runs directly, without opening a frame.',
    );
  });

  it('labels the receiver and the argument on the operand stack', () => {
    const program = collatzProgram();
    const snapshot = firstSnapshotOf(program, 'invokevirtual');

    expect(
      describeOperandRoles(snapshot, listingFor(program, snapshot), program.classFile),
    ).toEqual(['→ receiver', '→ arg 0']);
  });

  it('shows an interned standard-library object by its name in the locals', () => {
    const program = collatzProgram();
    const snapshot = firstSnapshotOf(program, 'invokevirtual');
    const frame = snapshot.callStack.at(-1);

    expect(
      describeValue(
        frame?.operandKinds?.at(-2),
        frame?.operandStack.at(-2) ?? 0,
        snapshot.heap ?? [],
        snapshot.externals ?? [],
      ),
    ).toBe('System.out');
  });
});

describe('value labels', () => {
  const heap: readonly HeapObject[] = [
    { kind: 'int-array', length: 3, elements: [0, 0, 0] },
    { kind: 'instance', className: 'Counter', fields: [] },
  ];
  const externals: readonly ExternalValue[] = [
    { className: 'java/io/PrintStream', label: 'System.out' },
  ];

  it('names a value by what it is rather than by the number in the cell', () => {
    expect(describeValue('int', 3, heap, externals)).toBe('3');
    expect(describeValue('ref', 0, heap, externals)).toBe('int[3]@0');
    expect(describeValue('ref', 1, heap, externals)).toBe('Counter@1');
    expect(describeValue('external', 0, heap, externals)).toBe('System.out');
  });

  it('has an answer for a reference that names nothing', () => {
    expect(describeValue('ref', -1, heap, externals)).toBe('null');
    expect(describeValue('external', 4, heap, externals)).toBe('an unknown object');
  });

  it('falls back to the number when a frame carries no kinds', () => {
    expect(describeValue(undefined, 7, heap, externals)).toBe('7');
  });
});

describe('object instructions', () => {
  const pool = new ConstantPoolBuilder();
  const fieldref = pool.fieldref('Synthetic', 'value', 'I');
  const foreignFieldref = pool.fieldref('Other', 'value', 'I');
  const ownStatic = pool.fieldref('Synthetic', 'counter', 'I');
  const systemOut = pool.fieldref('java/lang/System', 'out', 'Ljava/io/PrintStream;');
  const classIndex = pool.classEntry('Synthetic');
  const foreignClassIndex = pool.classEntry('java/lang/StringBuilder');
  const ownConstructor = pool.methodref('Synthetic', '<init>', '(I)V');
  const objectConstructor = pool.methodref('java/lang/Object', '<init>', '()V');
  const baseConstructor = pool.methodref('Base', '<init>', '()V');
  const mathMax = pool.methodref('java/lang/Math', 'max', '(II)I');
  const countsLongs = pool.methodref('Synthetic', 'count', '(J)V');
  const withoutCode = pool.methodref('Synthetic', 'stub', '()I');
  const classFile = syntheticClass({
    pool,
    methods: [
      { name: 'main', descriptor: '()V', code: [0xb1] },
      { name: '<init>', descriptor: '(I)V', code: [0xb1] },
      { name: 'count', descriptor: '(J)V', code: [0xb1] },
      { name: 'stub', descriptor: '()I' },
    ],
  });

  const heap: readonly HeapObject[] = [
    {
      kind: 'instance',
      className: 'Synthetic',
      fields: [{ name: 'value', descriptor: 'I', value: 41, kind: 'int' }],
    },
  ];

  function summaryAt(
    opcode: number,
    mnemonic: string,
    operands: readonly number[],
    operandStack: readonly number[],
    operandKinds: readonly ValueKind[],
  ) {
    const snapshot: Snapshot = {
      step: 0,
      callStack: [
        {
          methodName: 'main',
          methodDescriptor: '()V',
          pc: 0,
          operandStack,
          operandKinds,
          locals: [],
          localNames: [],
        },
      ],
      currentInstruction: { offset: 0, opcode, mnemonic, operands },
      heap,
      externals: [],
    };
    const summary = describeNextInstruction(snapshot, undefined, classFile);
    if (summary === undefined) {
      throw new Error(`no summary for ${mnemonic}`);
    }
    return summary;
  }

  it('says an allocation pushes a reference and leaves the constructor to follow', () => {
    const summary = summaryAt(0xbb, 'new', [classIndex], [], []);

    expect(summary.effects).toEqual([{ label: 'push ref' }]);
    expect(summary.explanation).toBe(
      'Allocates a Synthetic with every field at its default value and pushes the reference. ' +
        'Its constructor has not run yet; that is the invokespecial that follows.',
    );
  });

  it('reads a field through the object the reference names', () => {
    const summary = summaryAt(0xb4, 'getfield', [fieldref], [0], ['ref']);

    expect(summary.effects).toEqual([{ label: 'pop 1' }, { label: 'push int' }]);
    expect(summary.explanation).toBe(
      'Pops the reference to Synthetic@0 and pushes its field value, currently 41.',
    );
  });

  it('names the value and the object a field write lands in', () => {
    const summary = summaryAt(0xb5, 'putfield', [fieldref], [0, 7], ['ref', 'int']);

    expect(summary.effects).toEqual([{ label: 'pop 2' }]);
    expect(summary.explanation).toBe('Stores 7 in the field value of Synthetic@0.');
  });

  it('says an allocation of another class stops the run rather than promising a reference', () => {
    const summary = summaryAt(0xbb, 'new', [foreignClassIndex], [], []);

    expect(summary.explanation).toBe(
      'Allocates a java/lang/StringBuilder, which is outside this machine: it allocates ' +
        'instances of Synthetic, the loaded class, and of nothing else, so running it stops ' +
        'the program here.',
    );
  });

  it('refuses a field of another class rather than matching one of its own by name', () => {
    const read = summaryAt(0xb4, 'getfield', [foreignFieldref], [0], ['ref']);
    const write = summaryAt(0xb5, 'putfield', [foreignFieldref], [0, 7], ['ref', 'int']);
    const expected =
      'Reaches the field Other.value, which is outside this machine: a field resolves only on ' +
      'the loaded class, so running it stops the program here.';

    expect(read.explanation).toBe(expected);
    expect(write.explanation).toBe(expected);
  });

  it('says a static field the machine does not know stops the run rather than pushing', () => {
    const summary = summaryAt(0xb2, 'getstatic', [ownStatic], [], []);

    expect(summary.explanation).toBe(
      'Reads the static field Synthetic.counter, which is outside this machine: it knows ' +
        'System.out and no other static field, so running it stops the program here.',
    );
  });

  it('pushes the one static field the machine does know', () => {
    const summary = summaryAt(0xb2, 'getstatic', [systemOut], [], []);

    expect(summary.explanation).toBe('Pushes a reference to System.out onto the operand stack.');
  });

  it('opens a frame for a constructor declared by the loaded class', () => {
    const summary = summaryAt(0xb7, 'invokespecial', [ownConstructor], [0, 5], ['ref', 'int']);

    expect(summary.effects).toEqual([{ label: 'pop 2' }, { label: 'push frame' }]);
    expect(summary.explanation).toBe(
      'Pops 5 and the receiver Synthetic@0 and calls <init>(I)V, opening a frame with the ' +
        'receiver in slot 0. The callee starts at pc 0.',
    );
  });

  it('says the superclass constructor does nothing rather than pretending to run it', () => {
    const summary = summaryAt(0xb7, 'invokespecial', [objectConstructor], [0], ['ref']);

    expect(summary.effects).toEqual([{ label: 'pop 1' }]);
    expect(summary.explanation).toBe(
      'Pops the reference to Synthetic@0 and calls java/lang/Object.<init>()V, the constructor ' +
        'every chain of superclasses ends at; it does nothing, so the next instruction runs.',
    );
  });

  it('promises no frame for a call the interpreter refuses to enter', () => {
    const wide = summaryAt(0xb8, 'invokestatic', [countsLongs], [0, 0], ['int', 'int']);
    const codeless = summaryAt(0xb8, 'invokestatic', [withoutCode], [], []);
    const refused =
      ' which this machine cannot enter: a frame opens only for a method the loaded class ' +
      'declares, with a Code attribute and a descriptor of ints and references, so running it ' +
      'stops the program here.';

    expect(wide.effects).toEqual([{ label: 'pop 2' }]);
    expect(wide.explanation).toBe(`Calls Synthetic.count(J)V,${refused}`);
    expect(codeless.effects).toEqual([{ label: 'push int' }]);
    expect(codeless.explanation).toBe(`Calls Synthetic.stub()I,${refused}`);
  });

  it('reserves the do-nothing constructor for the one class that has it', () => {
    const summary = summaryAt(0xb7, 'invokespecial', [baseConstructor], [0], ['ref']);

    expect(summary.effects).toEqual([{ label: 'pop 1' }]);
    expect(summary.explanation).toBe(
      'Calls Base.<init>()V, which is outside this machine: everything has to resolve inside ' +
        'the loaded class or the standard-library calls it knows, so running it stops the ' +
        'program here.',
    );
  });

  it('does not promise a frame for a static call the machine answers itself', () => {
    const summary = summaryAt(0xb8, 'invokestatic', [mathMax], [4, 9], ['int', 'int']);

    expect(summary.effects).toEqual([{ label: 'pop 2' }, { label: 'push int' }]);
    expect(summary.explanation).toBe(
      'Pops 4 and 9 and calls java/lang/Math.max(II)I, one of the few standard-library methods ' +
        'this machine runs directly, without opening a frame.',
    );
  });

  it('labels the operands a field write is about to take', () => {
    const snapshot: Snapshot = {
      step: 0,
      callStack: [
        {
          methodName: 'main',
          methodDescriptor: '()V',
          pc: 0,
          operandStack: [0, 7],
          operandKinds: ['ref', 'int'],
          locals: [],
          localNames: [],
        },
      ],
      currentInstruction: { offset: 0, opcode: 0xb5, mnemonic: 'putfield', operands: [fieldref] },
      heap,
      externals: [],
    };

    expect(describeOperandRoles(snapshot, undefined, classFile)).toEqual(['→ object', '→ value']);
  });
});

describe('the opcode table', () => {
  const POOL_ROLES: Readonly<Record<string, 'method' | 'field' | 'class' | 'integer'>> = {
    ldc: 'integer',
    ldc_w: 'integer',
    getstatic: 'field',
    getfield: 'field',
    putfield: 'field',
    invokevirtual: 'method',
    invokespecial: 'method',
    invokestatic: 'method',
    new: 'class',
  };

  const pool = new ConstantPoolBuilder();
  const poolIndices = {
    method: pool.methodref('Synthetic', 'run', '(I)I'),
    field: pool.fieldref('Synthetic', 'value', 'I'),
    class: pool.classEntry('Synthetic'),
    integer: pool.integer(7),
  };
  const classFile = syntheticClass({
    pool,
    methods: [{ name: 'main', descriptor: '()V', code: [0xb1] }],
  });

  interface Form {
    readonly opcode: number;
    readonly mnemonic: string;
    readonly operands: readonly OperandSpec[];
  }

  function executableForms(): readonly Form[] {
    const forms: Form[] = [];
    for (const opcode of EXECUTABLE_OPCODES) {
      const info = lookupOpcode(opcode);
      if (info?.kind !== 'supported') {
        throw new Error(
          `opcode 0x${opcode.toString(16)} is executable but carries no stack effect`,
        );
      }
      forms.push({ opcode, mnemonic: info.mnemonic, operands: info.operands });

      const widened = WIDENED_FORMS.get(opcode);
      if (widened !== undefined && !widened.unsupported) {
        forms.push({ opcode, mnemonic: widened.mnemonic, operands: widened.operands });
      }
    }
    return forms;
  }

  function probeOf(form: Form): Snapshot {
    const poolIndex = poolIndices[POOL_ROLES[form.mnemonic] ?? 'integer'];
    const operands = form.operands.map((spec) => {
      if (spec.role === 'constant-pool-index') {
        return poolIndex;
      }
      if (spec.role === 'array-type') {
        return T_INT;
      }
      return spec.role === 'local-index' ? 0 : 1;
    });
    const branches = form.operands.some((spec) => spec.role === 'branch-offset');
    const switches = form.mnemonic === 'tableswitch' || form.mnemonic === 'lookupswitch';
    const frame: StackFrame = {
      methodName: 'main',
      methodDescriptor: '()V',
      pc: 0,
      operandStack: [3, 2, 1, 0],
      operandKinds: ['int', 'int', 'int', 'int'],
      locals: [0, 0, 0, 0],
      localNames: [],
    };
    return {
      step: 0,
      callStack: [frame],
      currentInstruction: {
        offset: 0,
        opcode: form.opcode,
        mnemonic: form.mnemonic,
        operands,
        ...(branches ? { branchTarget: 8 } : {}),
        ...(switches
          ? {
              switchTargets: [
                { match: undefined, target: 8 },
                { match: 1, target: 12 },
              ],
            }
          : {}),
      },
      heap: [],
      externals: [],
    };
  }

  const PILL = /^(pop \d+|pop frame|push frame|push (int|ref)|push \d+ (int|ref)s)$/;

  it('gives every executable instruction help, a stack delta and effect pills', () => {
    for (const form of executableForms()) {
      const { mnemonic } = form;
      const snapshot = probeOf(form);
      const instruction = snapshot.currentInstruction;
      if (instruction === undefined) {
        throw new Error(`no probe instruction for ${mnemonic}`);
      }
      const base = baseMnemonicOf(instruction);

      expect(explainMnemonic(base), mnemonic).toBeDefined();

      const delta = stackDeltaOf(instruction, classFile.constantPool);
      expect(delta, mnemonic).toBeDefined();

      const summary = describeNextInstruction(snapshot, undefined, classFile);
      const explanation = summary?.explanation ?? '';
      expect(explanation, mnemonic).toMatch(/\.$/);
      expect(explanation, mnemonic).not.toContain('undefined');
      expect(explanation, mnemonic).not.toContain('?');
      expect(explanation, mnemonic).not.toMatch(/^Executes /);

      const labels = summary?.effects.map((effect) => effect.label) ?? [];
      for (const label of labels) {
        expect(label, mnemonic).toMatch(PILL);
      }
      expect(
        labels.some((label) => /^pop \d+$/.test(label)),
        mnemonic,
      ).toBe((delta?.pops ?? 0) > 0);
      expect(labels.length === 0, mnemonic).toBe(
        delta?.pops === 0 && delta.pushes === 0 && OPCODE_NOTES[base]?.frame === undefined,
      );
    }
  });

  it('probes the forms the wide prefix mints as well as the narrow ones', () => {
    const mnemonics = executableForms().map((form) => form.mnemonic);

    expect(mnemonics).toEqual(
      expect.arrayContaining(['iload_w', 'istore_w', 'aload_w', 'astore_w', 'iinc_w']),
    );
    expect(new Set(mnemonics).size).toBe(mnemonics.length);
  });

  it('keeps the operand roles and the heap addressing of an instruction in step', () => {
    for (const [mnemonic, addressing] of Object.entries(OPERAND_ADDRESSING)) {
      const { handleDepth, indexDepth } = addressing;
      if (handleDepth === undefined) {
        continue;
      }
      expect(addressing.roles.length, mnemonic).toBeGreaterThanOrEqual(handleDepth);
      expect(addressing.roles[handleDepth - 1], mnemonic).toMatch(/array|object/);
      if (indexDepth !== undefined) {
        expect(addressing.roles[indexDepth - 1], mnemonic).toBe('→ index');
      }
    }
  });
});
