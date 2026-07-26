import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseClassFile, type ClassFile, type MethodInfo } from '../classfile';
import {
  javapMethod,
  readJavap,
  type JavapInstruction,
  type JavapMethod,
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
 * width desynchronises the offsets and shows up here immediately.
 */
const FACTORIAL_CLASS = new URL('../classfile/__fixtures__/Factorial.class', import.meta.url);
const FACTORIAL_JAVAP = new URL('../classfile/__fixtures__/Factorial.javap.txt', import.meta.url);
const OPCODE_ZOO_CLASS = new URL('./__fixtures__/OpcodeZoo.class', import.meta.url);
const OPCODE_ZOO_JAVAP = new URL('./__fixtures__/OpcodeZoo.javap.txt', import.meta.url);

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

const OPCODES_BY_MNEMONIC = new Map([...OPCODES.values()].map((info) => [info.mnemonic, info]));

/** Decoding cannot continue past these, so javap keeps listing where the decoder stops. */
const VARIABLE_LENGTH_MNEMONICS: ReadonlySet<string> = new Set([
  'tableswitch',
  'lookupswitch',
  'wide',
]);

/**
 * One listing row in a form both sides can produce, e.g. `2: if_icmpgt 7`. Operands are only
 * rendered for the MVP subset: outside it the decoder skips the bytes without reading them,
 * and the offsets lining up is precisely what proves it skipped the right number of them.
 *
 * javap prints the absolute branch target, so that is what the delta in `operands` is
 * compared through, and a constant pool index keeps its `#`.
 */
function renderDecoded(instruction: Instruction): string {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return `${String(instruction.offset)}: ${instruction.mnemonic}`;
  }

  const operands = info.operands.map((spec, index) => {
    if (spec.role === 'branch-offset') {
      return String(instruction.branchTarget ?? 0);
    }
    const value = instruction.operands[index] ?? 0;
    if (spec.role === 'constant-pool-index') {
      return `#${String(value)}`;
    }
    // javap prints `newarray int`, not the atype byte behind it.
    return spec.role === 'array-type' ? (arrayTypeName(value) ?? String(value)) : String(value);
  });
  return `${String(instruction.offset)}: ${instruction.mnemonic} ${operands.join(', ')}`.trimEnd();
}

function renderJavap(instruction: JavapInstruction): string {
  const info = OPCODES_BY_MNEMONIC.get(instruction.mnemonic);
  const operands = info?.kind === 'supported' ? instruction.operandText : '';
  return `${String(instruction.offset)}: ${instruction.mnemonic} ${operands}`.trimEnd();
}

/** Compares a decoded method with the javap dump of the same method, row for row. */
function expectJavapParity(code: Uint8Array, method: JavapMethod): void {
  const stop = method.instructions.findIndex((entry) =>
    VARIABLE_LENGTH_MNEMONICS.has(entry.mnemonic),
  );
  const decodable = stop < 0 ? method.instructions : method.instructions.slice(0, stop);
  const result = disassemble(code);

  expect(result.instructions.map(renderDecoded)).toEqual(decodable.map(renderJavap));
  expect(result.truncatedAtOffset).toBe(stop < 0 ? undefined : method.instructions[stop]?.offset);
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function mnemonicsOf(code: Uint8Array): readonly string[] {
  return disassemble(code).instructions.map((instruction) => instruction.mnemonic);
}

/** End offset of a decoded instruction; only fixed-length opcodes ever reach the listing. */
function endOffsetOf(instruction: Instruction): number {
  const info = lookupOpcode(instruction.opcode);
  if (info === undefined || info.kind === 'variable-length' || info.kind === 'reserved') {
    throw new Error(`instruction 0x${instruction.opcode.toString(16)} should not be decodable`);
  }
  return instruction.offset + 1 + info.operandBytes;
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

    // `aload_0` is in the subset since references exist; the call to Object.<init> is not.
    expect(
      result.instructions
        .filter((instruction) => instruction.unsupported === true)
        .map((instruction) => instruction.mnemonic),
    ).toEqual(['invokespecial']);
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

  it('skips the operands of instructions outside the subset by every width in the table', () => {
    const mnemonics = new Set<string>();
    const widths = new Set<number>();

    for (const [methodName] of METHODS) {
      for (const instruction of disassemble(codeIn(OPCODE_ZOO_CLASS, methodName)).instructions) {
        const info = lookupOpcode(instruction.opcode);
        if (info?.kind === 'unsupported') {
          mnemonics.add(info.mnemonic);
          widths.add(info.operandBytes);
          expect(instruction.unsupported).toBe(true);
          expect(instruction.operands).toEqual([]);
        }
      }
    }

    // 1 byte (ldc) through 4 (invokeinterface, invokedynamic), and the operandless ones.
    expect([...widths].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...mnemonics].sort()).toEqual(
      expect.arrayContaining([
        'anewarray',
        'checkcast',
        'getstatic',
        'instanceof',
        'invokedynamic',
        'invokeinterface',
        'invokespecial',
        'invokevirtual',
        'ldc',
        'ldc2_w',
        'multianewarray',
        'new',
      ]),
    );
  });

  it('stops at the switches, whose length javap can print but the decoder cannot compute', () => {
    // Both switches sit at offset 1, right behind the `iload_0` that pushes the selector.
    for (const methodName of ['table', 'lookup']) {
      const result = disassemble(codeIn(OPCODE_ZOO_CLASS, methodName));

      expect(result.instructions.map((instruction) => instruction.mnemonic)).toEqual(['iload_0']);
      expect(result.truncatedAtOffset).toBe(1);
    }
  });

  it('marks only the instructions the interpreter can run as supported', () => {
    const supported = new Set<string>();

    for (const [methodName] of METHODS) {
      for (const instruction of disassemble(codeIn(OPCODE_ZOO_CLASS, methodName)).instructions) {
        if (instruction.unsupported === undefined) {
          supported.add(instruction.mnemonic);
        }
      }
    }

    // The switch arms are in the subset too, but they sit behind a switch: never decoded.
    expect([...supported].sort()).toEqual([
      'aload_0',
      'aload_1',
      'arraylength',
      'astore_1',
      'dup',
      'iadd',
      'iaload',
      'iastore',
      'iconst_0',
      'iconst_1',
      'iconst_2',
      'iconst_3',
      'ifeq',
      'iload_0',
      'ireturn',
      'newarray',
      'pop',
      'return',
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

  it('leaves branchTarget unset for non-branching instructions', () => {
    for (const instruction of disassemble(codeOf('main')).instructions) {
      expect(instruction.branchTarget).toBeUndefined();
    }
  });
});

describe('disassemble — unsupported instructions', () => {
  it('lists a fixed-length unsupported opcode and keeps decoding after its operands', () => {
    // iconst_1; invokevirtual #5; iadd
    const result = disassemble(bytes(0x04, 0xb6, 0x00, 0x05, 0x60));

    expect(result.instructions).toEqual([
      { offset: 0, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
      { offset: 1, opcode: 0xb6, mnemonic: 'invokevirtual', operands: [], unsupported: true },
      { offset: 4, opcode: 0x60, mnemonic: 'iadd', operands: [] },
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
    const result = disassemble(bytes(0x04, 0xb6, 0x00, 0x05, 0x60));

    expect(result.instructions.map((instruction) => instruction.unsupported)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });
});

describe('disassemble — stopping conditions', () => {
  it('stops at tableswitch, whose length depends on padding and operands', () => {
    const result = disassemble(bytes(0x04, 0xaa, 0x00, 0x00, 0x00, 0x08, 0x60));

    expect(result.instructions).toEqual([
      { offset: 0, opcode: 0x04, mnemonic: 'iconst_1', operands: [] },
    ]);
    expect(result.truncatedAtOffset).toBe(1);
  });

  it('stops at lookupswitch and at wide', () => {
    expect(disassemble(bytes(0x00, 0xab, 0x00, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0x00, 0xc4, 0x15, 0x01, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0x00, 0xc4, 0x15, 0x01, 0x00)).instructions).toHaveLength(1);
  });

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

  it('stops cleanly when a supported operand runs past the end of code[]', () => {
    expect(disassemble(bytes(0x10))).toEqual({
      instructions: [],
      indexByOffset: new Map(),
      truncatedAtOffset: 0,
    });
    expect(disassemble(bytes(0x04, 0x11, 0x00)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0x04, 0x84, 0x01)).truncatedAtOffset).toBe(1);
    expect(disassemble(bytes(0xa7, 0x00)).instructions).toEqual([]);
  });

  it('stops cleanly when an unsupported operand runs past the end of code[]', () => {
    const result = disassemble(bytes(0x60, 0xb6, 0x00));

    expect(result.instructions).toHaveLength(1);
    expect(result.truncatedAtOffset).toBe(1);
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
  const supportedOpcodes: readonly SupportedOpcode[] = [...OPCODES.values()].filter(
    (info) => info.kind === 'supported',
  );

  /** Bytes biased towards real opcodes, so the generator reaches deeper listings. */
  const byteArbitrary = fc.oneof(
    fc.integer({ min: 0, max: 255 }),
    fc.constantFrom(...[...OPCODES.keys()]),
  );

  const codeArbitrary = fc
    .array(byteArbitrary, { maxLength: 64 })
    .map((values) => Uint8Array.from(values));

  it('never throws and never reports an instruction past the end of code[]', () => {
    fc.assert(
      fc.property(codeArbitrary, (code) => {
        const result = disassemble(code);
        let previousEnd = 0;

        for (const instruction of result.instructions) {
          expect(instruction.offset).toBe(previousEnd);
          expect(endOffsetOf(instruction)).toBeLessThanOrEqual(code.length);
          previousEnd = endOffsetOf(instruction);
        }

        // Every byte is accounted for: either the listing covers code[] completely,
        // or it ends exactly where decoding was abandoned.
        expect(result.truncatedAtOffset ?? code.length).toBe(previousEnd);
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

  it('decodes any concatenation of well-formed supported instructions completely', () => {
    const programArbitrary = fc
      .array(
        fc.constantFrom(...supportedOpcodes).chain((info) =>
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
