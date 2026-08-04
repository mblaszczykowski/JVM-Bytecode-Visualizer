import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile, type MethodInfo } from '../classfile';
import {
  javapMethod,
  readJavap,
  type JavapInstruction,
  type JavapMethod,
  type JavapSwitchCase,
} from './__fixtures__/javap';
import { disassemble } from './disassembler';
import { arrayTypeName, lookupOpcode, OPCODES, type SupportedOpcode } from './opcodes';
import type { Instruction } from './types';

/**
 * Parity is checked against the committed javap dumps, parsed rather than transcribed: what
 * the JDK printed is the expectation, so a decoder that drifts from it cannot be met halfway
 * by editing a listing in this file.
 *
 * `Factorial` is the int-only subset the interpreter runs. `OpcodeZoo` is everything around
 * it — one method per operand width the opcode table knows, plus both switches — so a wrong
 * width desynchronises the offsets and shows up here immediately. `WideOps` is the `wide`
 * prefix, which javac emits for nothing else than a local above slot 255.
 */
const FACTORIAL_CLASS = new URL('../classfile/__fixtures__/Factorial.class', import.meta.url);
const FACTORIAL_JAVAP = new URL('../classfile/__fixtures__/Factorial.javap.txt', import.meta.url);
const OPCODE_ZOO_CLASS = new URL('./__fixtures__/OpcodeZoo.class', import.meta.url);
const OPCODE_ZOO_JAVAP = new URL('./__fixtures__/OpcodeZoo.javap.txt', import.meta.url);
const WIDE_OPS_CLASS = new URL('./__fixtures__/WideOps.class', import.meta.url);
const WIDE_OPS_JAVAP = new URL('./__fixtures__/WideOps.javap.txt', import.meta.url);

function parseFixture(classFile: URL): ClassFile {
  // Copy into a fresh buffer: Node's Buffer can be a view into a shared pool.
  return parseClassFile(new Uint8Array(readFileSync(classFile)).buffer);
}

function codeIn(classFile: URL, methodName: string): Uint8Array {
  const method: MethodInfo | undefined = parseFixture(classFile).methods.find(
    (candidate) => candidate.name === methodName,
  );
  if (method?.code === undefined) {
    throw new Error(`fixture has no method ${methodName} with a Code attribute`);
  }
  return method.code.code;
}

function codeOf(methodName: string): Uint8Array {
  return codeIn(FACTORIAL_CLASS, methodName);
}

/**
 * One listing row in a form both sides can produce, e.g. `2: if_icmpgt 7`. Operands are
 * rendered from the roles in the opcode table, which is what makes them comparable: javap
 * prints the absolute branch target rather than the encoded delta, keeps the `#` on a constant
 * pool index and names a `newarray` element type instead of printing its atype byte.
 */
function renderDecoded(instruction: Instruction): string {
  const specs = lookupOpcode(instruction.opcode)?.operands ?? [];
  // JVMS requires a zero byte at the end of `invokeinterface` and `invokedynamic`; javap
  // prints everything before it and drops that one.
  const shown = specs.at(-1)?.role === 'mandated-zero' ? specs.slice(0, -1) : specs;

  const operands = shown.map((spec, index) => {
    const value = instruction.operands[index] ?? 0;
    if (spec.role === 'branch-offset') {
      return String(instruction.branchTarget ?? 0);
    }
    if (spec.role === 'constant-pool-index') {
      return `#${String(value)}`;
    }
    // A local slot, an immediate, a dimension count and an argument count all print as
    // themselves; only `newarray` names its operand instead of numbering it.
    return spec.role === 'array-type' ? (arrayTypeName(value) ?? String(value)) : String(value);
  });
  return `${String(instruction.offset)}: ${instruction.mnemonic} ${operands.join(', ')}`.trimEnd();
}

/** javap separates the operands of `#33,  2` by two spaces and those of `2, 1` by one. */
function renderJavap(instruction: JavapInstruction): string {
  const operands = instruction.operandText.replace(/\s+/g, ' ');
  return `${String(instruction.offset)}: ${instruction.mnemonic} ${operands}`.trimEnd();
}

/** javap prints the default arm last; the decoder puts it first, where the interpreter wants it. */
function defaultFirst(cases: readonly JavapSwitchCase[]): readonly JavapSwitchCase[] {
  return [
    ...cases.filter((arm) => arm.match === undefined),
    ...cases.filter((arm) => arm.match !== undefined),
  ];
}

/** Compares a decoded method with the javap dump of the same method, row for row. */
function expectJavapParity(code: Uint8Array, method: JavapMethod): void {
  const result = disassemble(code);

  expect(result.instructions.map(renderDecoded)).toEqual(method.instructions.map(renderJavap));
  // javac only emits instructions this decoder knows, so a fixture is never truncated.
  expect(result.truncatedAtOffset).toBeUndefined();

  for (const [index, decoded] of result.instructions.entries()) {
    const cases = method.instructions[index]?.switchCases ?? [];
    expect(decoded.switchTargets ?? []).toEqual(defaultFirst(cases));
  }
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function mnemonicsOf(code: Uint8Array): readonly string[] {
  return disassemble(code).instructions.map((instruction) => instruction.mnemonic);
}

describe('disassemble — javap parity on Factorial.class', () => {
  const dump = readJavap(FACTORIAL_JAVAP);

  it.each([
    ['factorial', 'static int factorial(int)'],
    ['main', 'public static void main(java.lang.String[])'],
    ['<init>', 'public Factorial()'],
  ])('reproduces the javap listing of %s', (methodName, signature) => {
    expectJavapParity(codeOf(methodName), javapMethod(dump, signature));
  });

  it('marks the constructor instructions outside the subset as unsupported', () => {
    const result = disassemble(codeOf('<init>'));

    // Every instruction of a default constructor is in the subset now that `invokespecial`
    // runs: `aload_0` puts the receiver up, the super call consumes it, `return` ends.
    expect(
      result.instructions
        .filter((instruction) => instruction.unsupported === true)
        .map((instruction) => instruction.mnemonic),
    ).toEqual([]);
  });

  it('keeps the encoded delta next to the resolved branch target', () => {
    // javap prints `if_icmpgt 7`; the stream holds the delta 5 relative to the opcode byte.
    expect(disassemble(codeOf('factorial')).instructions[2]).toEqual({
      offset: 2,
      opcode: 0xa3,
      mnemonic: 'if_icmpgt',
      operands: [5],
      branchTarget: 7,
    });
  });

  it('indexes every decoded instruction by its offset', () => {
    const result = disassemble(codeOf('factorial'));

    expect([...result.indexByOffset.entries()]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [5, 3],
      [6, 4],
      [7, 5],
      [8, 6],
      [9, 7],
      [10, 8],
      [11, 9],
      [14, 10],
      [15, 11],
    ]);
  });
});

describe('disassemble — javap parity on OpcodeZoo.class', () => {
  const dump = readJavap(OPCODE_ZOO_JAVAP);

  /** Every method of the fixture, with the signature javap prints for it. */
  const METHODS: readonly (readonly [string, string])[] = [
    ['<init>', 'public OpcodeZoo()'],
    ['table', 'static int table(int)'],
    ['lookup', 'static int lookup(int)'],
    ['array', 'static int array(int)'],
    ['wide', 'static int wide(int)'],
    ['half', 'static double half()'],
    ['grid', 'static java.lang.String[][] grid()'],
    ['names', 'static java.lang.Object[] names()'],
    ['print', 'static void print(java.lang.String)'],
    ['size', 'static int size(java.lang.String)'],
    ['greet', 'static java.lang.String greet(int)'],
    ['empty', 'static boolean empty(java.lang.Object)'],
  ];

  it.each(METHODS)('reproduces the javap listing of %s', (methodName, signature) => {
    expectJavapParity(codeIn(OPCODE_ZOO_CLASS, methodName), javapMethod(dump, signature));
  });

  it('decodes the operands of every instruction, in or out of the executable subset', () => {
    const withOperands = new Map<string, readonly number[]>();

    for (const [methodName] of METHODS) {
      for (const instruction of disassemble(codeIn(OPCODE_ZOO_CLASS, methodName)).instructions) {
        if (instruction.operands.length > 0) {
          withOperands.set(instruction.mnemonic, instruction.operands);
        }
      }
    }

    // The instructions the decoder used to list bare, now carrying their real pool indices.
    expect(withOperands.get('invokespecial')).toEqual([32]);
    expect(withOperands.get('ldc2_w')).toEqual([8]);
    expect(withOperands.get('anewarray')).toEqual([12]);
    expect(withOperands.get('checkcast')).toEqual([12]);
    expect(withOperands.get('instanceof')).toEqual([12]);
    // Both operands of the three-byte and four-byte forms, mandated zero byte included.
    expect(withOperands.get('multianewarray')).toEqual([10, 2]);
    expect(withOperands.get('invokeinterface')).toEqual([39, 1, 0]);
    expect(withOperands.get('invokedynamic')).toEqual([43, 0, 0]);
  });

  it('decodes both switches, arms and all, instead of stopping at them', () => {
    const table = disassemble(codeIn(OPCODE_ZOO_CLASS, 'table'));
    const lookup = disassemble(codeIn(OPCODE_ZOO_CLASS, 'lookup'));

    // Both switches sit at offset 1, right behind the `iload_0` that pushes the selector.
    expect(table.instructions[1]?.switchTargets).toEqual([
      { match: undefined, target: 37 },
      { match: 0, target: 28 },
      { match: 1, target: 31 },
      { match: 2, target: 34 },
    ]);
    expect(lookup.instructions[1]?.switchTargets).toEqual([
      { match: undefined, target: 42 },
      { match: 1, target: 36 },
      { match: 500, target: 38 },
      { match: 100_000, target: 40 },
    ]);
    expect(table.truncatedAtOffset).toBeUndefined();
    expect(lookup.truncatedAtOffset).toBeUndefined();
  });

  it('marks only the instructions the interpreter can run as supported', () => {
    const supported = new Set<string>();
    const unsupported = new Set<string>();

    for (const [methodName] of METHODS) {
      for (const instruction of disassemble(codeIn(OPCODE_ZOO_CLASS, methodName)).instructions) {
        (instruction.unsupported === undefined ? supported : unsupported).add(instruction.mnemonic);
      }
    }

    // Every switch arm is reachable now, so the arms of `table` and `lookup` are listed too.
    expect([...supported].sort()).toEqual([
      'aload_0',
      'aload_1',
      'areturn',
      'arraylength',
      'astore_1',
      'bipush',
      'dup',
      'getstatic',
      'iadd',
      'iaload',
      'iastore',
      'iconst_0',
      'iconst_1',
      'iconst_2',
      'iconst_3',
      'iconst_m1',
      'ifeq',
      'iload_0',
      'invokespecial',
      'invokevirtual',
      'ireturn',
      'ldc',
      'lookupswitch',
      'new',
      'newarray',
      'pop',
      'return',
      'tableswitch',
    ]);
    expect([...unsupported].sort()).toEqual([
      'aastore',
      'anewarray',
      'checkcast',
      'dreturn',
      'instanceof',
      'invokedynamic',
      'invokeinterface',
      'ldc2_w',
      'multianewarray',
    ]);
  });
});

describe('disassemble — javap parity on WideOps.class', () => {
  const dump = readJavap(WIDE_OPS_JAVAP);

  it.each([
    ['far', 'static int far(int)'],
    ['main', 'public static void main(java.lang.String[])'],
  ])('reproduces the javap listing of %s', (methodName, signature) => {
    expectJavapParity(codeIn(WIDE_OPS_CLASS, methodName), javapMethod(dump, signature));
  });

  it('folds the wide prefix into the instruction it widens, as javap does', () => {
    const instructions = disassemble(codeIn(WIDE_OPS_CLASS, 'far')).instructions;

    // One row per wide form, at the offset of the 0xc4 byte, carrying the widened operands
    // and the opcode of the instruction that was widened — 0x36 istore, 0x84 iinc, 0x15 iload.
    expect(instructions.slice(3)).toEqual([
      { offset: 3, opcode: 0x36, mnemonic: 'istore_w', operands: [257] },
      { offset: 7, opcode: 0x84, mnemonic: 'iinc_w', operands: [257, 200] },
      { offset: 13, opcode: 0x15, mnemonic: 'iload_w', operands: [257] },
      { offset: 17, opcode: 0xac, mnemonic: 'ireturn', operands: [] },
    ]);
  });
});

describe('disassemble — operand signedness', () => {
  it('reads the bipush operand as a signed byte', () => {
    expect(disassemble(bytes(0x10, 0xff)).instructions).toEqual([
      { offset: 0, opcode: 0x10, mnemonic: 'bipush', operands: [-1] },
    ]);
    expect(disassemble(bytes(0x10, 0x80)).instructions[0]?.operands).toEqual([-128]);
    expect(disassemble(bytes(0x10, 0x7f)).instructions[0]?.operands).toEqual([127]);
  });

  it('reads the sipush operand as a signed short', () => {
    expect(disassemble(bytes(0x11, 0xff, 0xff)).instructions[0]?.operands).toEqual([-1]);
    expect(disassemble(bytes(0x11, 0x80, 0x00)).instructions[0]?.operands).toEqual([-32768]);
    expect(disassemble(bytes(0x11, 0x01, 0x00)).instructions[0]?.operands).toEqual([256]);
  });

  it('reads iinc as an unsigned slot index and a signed increment', () => {
    expect(disassemble(bytes(0x84, 0xfe, 0xff)).instructions).toEqual([
      { offset: 0, opcode: 0x84, mnemonic: 'iinc', operands: [254, -1] },
    ]);
    expect(disassemble(bytes(0x84, 0x02, 0x80)).instructions[0]?.operands).toEqual([2, -128]);
  });

  it('reads local variable and constant pool indices as unsigned', () => {
    expect(disassemble(bytes(0x15, 0xff)).instructions[0]?.operands).toEqual([255]);
    expect(disassemble(bytes(0x36, 0x80)).instructions[0]?.operands).toEqual([128]);
    expect(disassemble(bytes(0xb8, 0xff, 0xfe)).instructions[0]?.operands).toEqual([65534]);
    // `ldc` addresses the pool with a single unsigned byte, `ldc_w` with two.
    expect(disassemble(bytes(0x12, 0xff)).instructions[0]?.operands).toEqual([255]);
    expect(disassemble(bytes(0x13, 0xff, 0xff)).instructions[0]?.operands).toEqual([65535]);
  });
});

describe('disassemble — branch targets', () => {
  it('resolves a forward branch relative to the opcode byte, not to the operands', () => {
    // nop; goto +4 -> 5
    const result = disassemble(bytes(0x00, 0xa7, 0x00, 0x04, 0x00, 0x00));

    expect(result.instructions[1]).toEqual({
      offset: 1,
      opcode: 0xa7,
      mnemonic: 'goto',
      operands: [4],
      branchTarget: 5,
    });
  });

  it('resolves a backward branch to an offset before the instruction', () => {
    // nop; nop; nop; goto -3 -> 0 (the loop shape javac emits for while/for)
    const result = disassemble(bytes(0x00, 0x00, 0x00, 0xa7, 0xff, 0xfd));
    const branch = result.instructions[3];

    expect(branch).toEqual({
      offset: 3,
      opcode: 0xa7,
      mnemonic: 'goto',
      operands: [-3],
      branchTarget: 0,
    });
    expect(branch?.branchTarget).toBeLessThan(branch?.offset ?? 0);
  });

  it('resolves conditional branch targets the same way', () => {
    const result = disassemble(bytes(0x9f, 0x00, 0x06, 0xa3, 0xff, 0xff));

    expect(result.instructions).toEqual([
      { offset: 0, opcode: 0x9f, mnemonic: 'if_icmpeq', operands: [6], branchTarget: 6 },
      { offset: 3, opcode: 0xa3, mnemonic: 'if_icmpgt', operands: [-1], branchTarget: 2 },
    ]);
  });

  it('reads the goto_w and jsr_w deltas as signed four-byte values', () => {
    // JVMS §6.5 goto_w: the wide jump javac emits for a method body above 32 KiB.
    expect(disassemble(bytes(0xc8, 0x00, 0x01, 0x00, 0x00)).instructions).toEqual([
      {
        offset: 0,
        opcode: 0xc8,
        mnemonic: 'goto_w',
        operands: [65_536],
        branchTarget: 65_536,
        unsupported: true,
      },
    ]);
    expect(disassemble(bytes(0x00, 0xc9, 0xff, 0xff, 0xff, 0xff)).instructions[1]).toEqual({
      offset: 1,
      opcode: 0xc9,
      mnemonic: 'jsr_w',
      operands: [-1],
      branchTarget: 0,
      unsupported: true,
    });
  });

  it('leaves branchTarget unset for non-branching instructions', () => {
    for (const instruction of disassemble(codeOf('main')).instructions) {
      expect(instruction.branchTarget).toBeUndefined();
    }
  });
});

describe('disassemble — instructions outside the executable subset', () => {
  it('decodes an unsupported opcode in full and keeps decoding after its operands', () => {
    // iconst_1; invokevirtual #5; checkcast #7; iadd
    const result = disassemble(bytes(0x04, 0xb6, 0x00, 0x05, 0xc0, 0x00, 0x07, 0x60));

    expect(result.instructions).toEqual([
      { offset: 0, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
      { offset: 1, opcode: 0xb6, mnemonic: 'invokevirtual', operands: [5] },
      { offset: 4, opcode: 0xc0, mnemonic: 'checkcast', operands: [7], unsupported: true },
      { offset: 7, opcode: 0x60, mnemonic: 'iadd', operands: [] },
    ]);
    expect(result.truncatedAtOffset).toBeUndefined();
  });

  it('uses the real JVM mnemonic so errors can name the instruction', () => {
    // getstatic #2; ldc #3; invokevirtual #4 — the System.out.println shape
    expect(mnemonicsOf(bytes(0xb2, 0x00, 0x02, 0x12, 0x03, 0xb6, 0x00, 0x04))).toEqual([
      'getstatic',
      'ldc',
      'invokevirtual',
    ]);
  });

  it('marks only out-of-subset opcodes as unsupported', () => {
    // `monitorenter` is decodable and out of the subset; `athrow` was too, until the exception
    // table gave it somewhere to go.
    const result = disassemble(bytes(0x04, 0xbf, 0xc2, 0x60));

    expect(result.instructions.map((instruction) => instruction.unsupported)).toEqual([
      undefined,
      undefined,
      true,
      undefined,
    ]);
  });
});

describe('disassemble — the variable-length instructions', () => {
  /** `code[]` where a tableswitch starts at `offset`, so the padding varies with it. */
  function tableSwitchAt(offset: number): Uint8Array {
    const code = [
      ...new Array<number>(offset).fill(0x00), // nop padding in front of the switch
      0xaa,
    ];
    while (code.length % 4 !== 0) {
      code.push(0x00); // JVMS §6.5: 0-3 pad bytes, counted from the start of code[]
    }
    // default = +40, low = 1, high = 2, targets +20 and +30
    code.push(0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 20, 0, 0, 0, 30);
    return Uint8Array.from(code);
  }

  it.each([0, 1, 2, 3])('skips the padding of a tableswitch at offset %i', (offset) => {
    const result = disassemble(tableSwitchAt(offset));
    const decoded = result.instructions.at(-1);

    expect(decoded?.mnemonic).toBe('tableswitch');
    expect(decoded?.switchTargets).toEqual([
      { match: undefined, target: offset + 40 },
      { match: 1, target: offset + 20 },
      { match: 2, target: offset + 30 },
    ]);
    expect(result.truncatedAtOffset).toBeUndefined();
  });

  it('decodes a lookupswitch with no arms at all', () => {
    // JVMS §6.5 lookupswitch: npairs may be zero, which javac emits for `switch (x) {}`.
    // Layout: opcode, 3 pad bytes, default = +9, npairs = 0.
    const result = disassemble(bytes(0xab, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0));

    expect(result.instructions[0]?.switchTargets).toEqual([{ match: undefined, target: 9 }]);
    expect(result.truncatedAtOffset).toBeUndefined();
  });

  it('stops at a switch whose table does not fit in code[]', () => {
    // A tableswitch claiming 1000 arms in sixteen bytes is corruption, not a long switch.
    expect(
      disassemble(bytes(0xaa, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 3, 0xe8)).truncatedAtOffset,
    ).toBe(0);
    // high < low: JVMS requires low <= high, so the arm count would be negative.
    expect(
      disassemble(bytes(0xaa, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 9, 0, 0, 0, 1)).truncatedAtOffset,
    ).toBe(0);
    // A negative npairs is the same corruption in the other switch.
    expect(
      disassemble(bytes(0xab, 0, 0, 0, 0, 0, 0, 4, 0xff, 0xff, 0xff, 0xff)).truncatedAtOffset,
    ).toBe(0);
    // Not even the fixed head of the instruction fits.
    expect(disassemble(bytes(0x00, 0xaa, 0x00, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0xaa, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0)).truncatedAtOffset).toBe(0);
  });

  /** The `wide` prefix in front of the instruction it widens (JVMS §6.5 wide). */
  function widened(opcode: number, ...operands: number[]): readonly number[] {
    return [0xc4, opcode, ...operands];
  }

  it('decodes every instruction the wide prefix may carry', () => {
    const result = disassemble(
      bytes(
        ...widened(0x15, 0x01, 0x2c), //             wide iload 300
        ...widened(0x3a, 0x01, 0x90), //             wide astore 400
        ...widened(0x84, 0x01, 0x2c, 0xff, 0xff), // wide iinc 300, -1
        ...widened(0xa9, 0x00, 0x04), //             wide ret 4
      ),
    );

    expect(result.instructions).toEqual([
      { offset: 0, opcode: 0x15, mnemonic: 'iload_w', operands: [300] },
      { offset: 4, opcode: 0x3a, mnemonic: 'astore_w', operands: [400] },
      { offset: 8, opcode: 0x84, mnemonic: 'iinc_w', operands: [300, -1] },
      // `ret` belongs to the abandoned jsr/ret pair, so its wide form is listed, not runnable.
      { offset: 14, opcode: 0xa9, mnemonic: 'ret_w', operands: [4], unsupported: true },
    ]);
    expect(result.truncatedAtOffset).toBeUndefined();
  });

  it('stops at a wide prefix on an instruction it cannot widen', () => {
    // `wide iadd` is not an instruction: JVMS lists the twelve opcodes wide may precede.
    expect(disassemble(bytes(0x00, ...widened(0x60), 0x00)).truncatedAtOffset).toBe(1);
    // A wide prefix as the last byte of the method has nothing to widen either.
    expect(disassemble(bytes(0x00, 0xc4)).truncatedAtOffset).toBe(1);
    // The widened operands themselves can run past the end.
    expect(disassemble(bytes(...widened(0x15, 0x01))).truncatedAtOffset).toBe(0);
    expect(disassemble(bytes(...widened(0x84, 0x01, 0x2c, 0xff))).truncatedAtOffset).toBe(0);
  });
});

describe('disassemble — stopping conditions', () => {
  it('stops at a reserved opcode', () => {
    for (const reserved of [0xca, 0xfe, 0xff]) {
      const result = disassemble(bytes(0x00, reserved, 0x00));

      expect(result.instructions).toHaveLength(1);
      expect(result.truncatedAtOffset).toBe(1);
    }
  });

  it('stops at an unassigned opcode byte', () => {
    const result = disassemble(bytes(0x00, 0xcb, 0x00));

    expect(result.instructions).toHaveLength(1);
    expect(result.truncatedAtOffset).toBe(1);
  });

  it('stops cleanly when an operand runs past the end of code[]', () => {
    expect(disassemble(bytes(0x10))).toEqual({
      instructions: [],
      indexByOffset: new Map(),
      truncatedAtOffset: 0,
    });
    expect(disassemble(bytes(0x04, 0x11, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0x04, 0x84, 0x01)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0xa7, 0x00)).instructions).toEqual([]);
    // The same for an instruction outside the executable subset, and for a four-byte operand.
    expect(disassemble(bytes(0x60, 0xb7, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0xc8, 0x00, 0x00, 0x01)).truncatedAtOffset).toBe(0);
  });

  it('returns an empty, untruncated listing for empty code[]', () => {
    const result = disassemble(new Uint8Array(0));

    expect(result.instructions).toEqual([]);
    expect(result.indexByOffset.size).toBe(0);
    expect(result.truncatedAtOffset).toBeUndefined();
  });

  it('decodes a view into a larger buffer without reading past its window', () => {
    const backing = bytes(0xff, 0x04, 0x10, 0x2a, 0xff);
    const window = new Uint8Array(backing.buffer, 1, 3);

    expect(disassemble(window).instructions).toEqual([
      { offset: 0, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
      { offset: 1, opcode: 0x10, mnemonic: 'bipush', operands: [42] },
    ]);
  });
});

describe('disassemble — properties on arbitrary input', () => {
  /** Fixed-length opcodes only: a switch is sized by its own bytes, not by the table. */
  const fixedLengthOpcodes: readonly (SupportedOpcode & { operandBytes: number })[] = [
    ...OPCODES.values(),
  ].flatMap((info) =>
    info.kind === 'supported' && info.operandBytes !== undefined
      ? [{ ...info, operandBytes: info.operandBytes }]
      : [],
  );

  /** Bytes biased towards real opcodes, so the generator reaches deeper listings. */
  const byteArbitrary = fc.oneof(
    fc.integer({ min: 0, max: 255 }),
    fc.constantFrom(...[...OPCODES.keys()]),
  );

  const codeArbitrary = fc
    .array(byteArbitrary, { maxLength: 64 })
    .map((values) => Uint8Array.from(values));

  it('never throws and covers code[] from the first byte without a gap', () => {
    fc.assert(
      fc.property(codeArbitrary, (code) => {
        const result = disassemble(code);
        const end = result.truncatedAtOffset ?? code.length;

        let previousOffset = -1;
        for (const instruction of result.instructions) {
          expect(instruction.offset).toBeGreaterThan(previousOffset);
          expect(instruction.offset).toBeLessThan(end);
          previousOffset = instruction.offset;
        }
        // Either the listing starts at byte 0 or nothing at all was decodable.
        expect(result.instructions[0]?.offset ?? 0).toBe(0);
        expect(end).toBeLessThanOrEqual(code.length);
      }),
    );
  });

  it('keeps indexByOffset consistent with the listing', () => {
    fc.assert(
      fc.property(codeArbitrary, (code) => {
        const { instructions, indexByOffset } = disassemble(code);

        expect(indexByOffset.size).toBe(instructions.length);
        for (const [offset, index] of indexByOffset) {
          expect(instructions[index]?.offset).toBe(offset);
        }
        for (const [index, instruction] of instructions.entries()) {
          expect(indexByOffset.get(instruction.offset)).toBe(index);
        }
      }),
    );
  });

  it('keeps branchTarget equal to the instruction offset plus the decoded delta', () => {
    fc.assert(
      fc.property(codeArbitrary, (code) => {
        for (const instruction of disassemble(code).instructions) {
          if (instruction.branchTarget !== undefined) {
            expect(instruction.branchTarget).toBe(
              instruction.offset + (instruction.operands[0] ?? 0),
            );
          }
        }
      }),
    );
  });

  it('gives every switch a default arm, and only the default arm no match value', () => {
    fc.assert(
      fc.property(codeArbitrary, (code) => {
        for (const { switchTargets } of disassemble(code).instructions) {
          if (switchTargets !== undefined) {
            expect(switchTargets[0]?.match).toBeUndefined();
            expect(switchTargets.slice(1).every((arm) => arm.match !== undefined)).toBe(true);
          }
        }
      }),
    );
  });

  it('decodes any concatenation of well-formed fixed-length instructions completely', () => {
    const programArbitrary = fc
      .array(
        fc.constantFrom(...fixedLengthOpcodes).chain((info) =>
          fc
            .array(fc.integer({ min: 0, max: 255 }), {
              minLength: info.operandBytes,
              maxLength: info.operandBytes,
            })
            .map((operands) => ({ mnemonic: info.mnemonic, bytes: [info.opcode, ...operands] })),
        ),
        { maxLength: 24 },
      )
      .map((chunks) => ({
        code: Uint8Array.from(chunks.flatMap((chunk) => chunk.bytes)),
        mnemonics: chunks.map((chunk) => chunk.mnemonic),
      }));

    fc.assert(
      fc.property(programArbitrary, ({ code, mnemonics }) => {
        const result = disassemble(code);

        expect(result.truncatedAtOffset).toBeUndefined();
        expect(result.instructions.map((instruction) => instruction.mnemonic)).toEqual(mnemonics);
        expect(
          result.instructions.every((instruction) => instruction.unsupported === undefined),
        ).toBe(true);
      }),
    );
  });
});
