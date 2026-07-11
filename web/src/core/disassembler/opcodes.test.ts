import { describe, expect, it } from 'vitest';

import {
  isSupportedOpcode,
  lookupOpcode,
  operandWidth,
  OPCODES,
  type OpcodeInfo,
  type OperandType,
} from './opcodes';

/**
 * The MVP instruction subset the interpreter executes — nothing outside this list may be
 * marked `supported`, or the interpreter would be asked to run something it cannot.
 */
const MVP_OPCODES: readonly (readonly [opcode: number, mnemonic: string])[] = [
  [0x00, 'nop'],
  [0x02, 'iconst_m1'],
  [0x03, 'iconst_0'],
  [0x04, 'iconst_1'],
  [0x05, 'iconst_2'],
  [0x06, 'iconst_3'],
  [0x07, 'iconst_4'],
  [0x08, 'iconst_5'],
  [0x10, 'bipush'],
  [0x11, 'sipush'],
  [0x15, 'iload'],
  [0x1a, 'iload_0'],
  [0x1b, 'iload_1'],
  [0x1c, 'iload_2'],
  [0x1d, 'iload_3'],
  [0x36, 'istore'],
  [0x3b, 'istore_0'],
  [0x3c, 'istore_1'],
  [0x3d, 'istore_2'],
  [0x3e, 'istore_3'],
  [0x57, 'pop'],
  [0x59, 'dup'],
  [0x60, 'iadd'],
  [0x64, 'isub'],
  [0x68, 'imul'],
  [0x6c, 'idiv'],
  [0x70, 'irem'],
  [0x74, 'ineg'],
  [0x84, 'iinc'],
  [0x99, 'ifeq'],
  [0x9a, 'ifne'],
  [0x9b, 'iflt'],
  [0x9c, 'ifge'],
  [0x9d, 'ifgt'],
  [0x9e, 'ifle'],
  [0x9f, 'if_icmpeq'],
  [0xa0, 'if_icmpne'],
  [0xa1, 'if_icmplt'],
  [0xa2, 'if_icmpge'],
  [0xa3, 'if_icmpgt'],
  [0xa4, 'if_icmple'],
  [0xa7, 'goto'],
  [0xac, 'ireturn'],
  [0xb1, 'return'],
  [0xb8, 'invokestatic'],
];

const HIGHEST_ASSIGNED_OPCODE = 0xca; // breakpoint (reserved) closes the contiguous range
const RESERVED_OPCODES = [0xca, 0xfe, 0xff];

function infoFor(opcode: number): OpcodeInfo {
  const info = lookupOpcode(opcode);
  expect(info, `opcode 0x${opcode.toString(16)} missing from the table`).toBeDefined();
  if (info === undefined) {
    throw new Error('unreachable');
  }
  return info;
}

function encodingOf(mnemonicOpcode: number): readonly (readonly [OperandType, string])[] {
  const info = infoFor(mnemonicOpcode);
  if (info.kind !== 'supported') {
    throw new Error(`opcode 0x${mnemonicOpcode.toString(16)} is not supported`);
  }
  return info.operands.map((operand) => [operand.type, operand.role] as const);
}

describe('opcode table coverage', () => {
  it('contains every assigned opcode from 0x00 to 0xca plus impdep1/impdep2', () => {
    const expected = [
      ...Array.from({ length: HIGHEST_ASSIGNED_OPCODE + 1 }, (_, opcode) => opcode),
      0xfe,
      0xff,
    ];

    expect([...OPCODES.keys()].sort((a, b) => a - b)).toEqual(expected);
  });

  it('leaves the unassigned bytes 0xcb-0xfd out of the table', () => {
    for (let opcode = 0xcb; opcode <= 0xfd; opcode += 1) {
      expect(lookupOpcode(opcode)).toBeUndefined();
    }
  });

  it('keys every entry by its own opcode value', () => {
    for (const [key, info] of OPCODES) {
      expect(info.opcode).toBe(key);
    }
  });

  it('gives every opcode a non-empty, unique mnemonic', () => {
    const mnemonics = [...OPCODES.values()].map((info) => info.mnemonic);

    for (const mnemonic of mnemonics) {
      expect(mnemonic).not.toBe('');
      expect(mnemonic).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(new Set(mnemonics).size).toBe(mnemonics.length);
  });

  it('gives every fixed-length opcode a non-negative operand byte count', () => {
    for (const info of OPCODES.values()) {
      if (info.kind === 'supported' || info.kind === 'unsupported') {
        expect(info.operandBytes).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(info.operandBytes)).toBe(true);
      }
    }
  });
});

describe('opcode classification', () => {
  it('marks exactly the MVP subset as supported', () => {
    const supported = [...OPCODES.values()]
      .filter((info) => info.kind === 'supported')
      .map((info) => [info.opcode, info.mnemonic] as const)
      .sort((a, b) => a[0] - b[0]);

    expect(supported).toEqual(MVP_OPCODES);
    expect(supported).toHaveLength(45);
  });

  it('marks tableswitch, lookupswitch and wide as variable-length', () => {
    const variableLength = [...OPCODES.values()]
      .filter((info) => info.kind === 'variable-length')
      .map((info) => info.mnemonic);

    expect(variableLength).toEqual(['tableswitch', 'lookupswitch', 'wide']);
  });

  it('marks the JVMS §6.2 reserved opcodes as reserved', () => {
    const reserved = [...OPCODES.values()]
      .filter((info) => info.kind === 'reserved')
      .map((info) => info.opcode);

    expect(reserved).toEqual(RESERVED_OPCODES);
    expect(reserved.map((opcode) => infoFor(opcode).mnemonic)).toEqual([
      'breakpoint',
      'impdep1',
      'impdep2',
    ]);
  });

  it('reports common non-MVP instructions as unsupported but decodable', () => {
    expect(infoFor(0xb6)).toEqual({
      kind: 'unsupported',
      opcode: 0xb6,
      mnemonic: 'invokevirtual',
      operandBytes: 2,
    });
    expect(infoFor(0xb9)).toMatchObject({ mnemonic: 'invokeinterface', operandBytes: 4 });
    expect(infoFor(0xc5)).toMatchObject({ mnemonic: 'multianewarray', operandBytes: 3 });
    expect(isSupportedOpcode(0xb6)).toBe(false);
    expect(isSupportedOpcode(0xb8)).toBe(true);
  });
});

describe('operand encoding of supported opcodes', () => {
  it('agrees with the declared operand byte count', () => {
    for (const info of OPCODES.values()) {
      if (info.kind !== 'supported') {
        continue;
      }
      const encodedBytes = info.operands.reduce(
        (total, operand) => total + operandWidth(operand.type),
        0,
      );
      expect(encodedBytes, `operand encoding of ${info.mnemonic}`).toBe(info.operandBytes);
    }
  });

  it('reads bipush as a signed byte and sipush as a signed short (JVMS §6.5)', () => {
    expect(encodingOf(0x10)).toEqual([['i1', 'immediate']]);
    expect(encodingOf(0x11)).toEqual([['i2', 'immediate']]);
  });

  it('reads local variable indices as unsigned bytes', () => {
    expect(encodingOf(0x15)).toEqual([['u1', 'local-index']]);
    expect(encodingOf(0x36)).toEqual([['u1', 'local-index']]);
  });

  it('reads iinc as an unsigned index followed by a signed increment', () => {
    expect(encodingOf(0x84)).toEqual([
      ['u1', 'local-index'],
      ['i1', 'immediate'],
    ]);
  });

  it('reads every branch delta as a signed short', () => {
    for (const opcode of [0x99, 0x9e, 0x9f, 0xa4, 0xa7]) {
      expect(encodingOf(opcode)).toEqual([['i2', 'branch-offset']]);
    }
  });

  it('reads the invokestatic constant pool index as an unsigned short', () => {
    expect(encodingOf(0xb8)).toEqual([['u2', 'constant-pool-index']]);
  });

  it('leaves opcodes without operands with an empty encoding', () => {
    for (const opcode of [0x00, 0x04, 0x1a, 0x3c, 0x60, 0xac, 0xb1]) {
      expect(encodingOf(opcode)).toEqual([]);
    }
  });
});

describe('stack effects of supported opcodes', () => {
  it('describes constants, loads and stores', () => {
    expect(infoFor(0x04)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x10)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x1a)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x3c)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 0 } });
    expect(infoFor(0x84)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 0 } });
  });

  it('describes stack and arithmetic instructions', () => {
    expect(infoFor(0x57)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 0 } });
    expect(infoFor(0x59)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 2 } });
    expect(infoFor(0x68)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 2, pushes: 1 } });
    expect(infoFor(0x74)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 1 } });
  });

  it('describes branches by how many values the comparison consumes', () => {
    expect(infoFor(0x99)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 0 } });
    expect(infoFor(0xa3)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 2, pushes: 0 } });
    expect(infoFor(0xa7)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 0 } });
  });

  it('leaves calls and returns as varying — the descriptor and the caller frame decide', () => {
    for (const opcode of [0xb8, 0xac, 0xb1]) {
      expect(infoFor(opcode)).toMatchObject({ stackEffect: { kind: 'varies' } });
    }
  });
});

describe('operandWidth', () => {
  it('maps each operand type to its byte width', () => {
    expect(operandWidth('u1')).toBe(1);
    expect(operandWidth('i1')).toBe(1);
    expect(operandWidth('u2')).toBe(2);
    expect(operandWidth('i2')).toBe(2);
  });
});
