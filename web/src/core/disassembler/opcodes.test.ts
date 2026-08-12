import { describe, expect, it } from 'vitest';

import {
  arrayTypeName,
  isSupportedOpcode,
  lookupOpcode,
  operandWidth,
  OPCODES,
  T_INT,
  WIDENED_FORMS,
  type OpcodeInfo,
  type OperandType,
} from './opcodes';

const EXECUTABLE_OPCODES: readonly (readonly [opcode: number, mnemonic: string])[] = [
  [0x00, 'nop'],
  [0x01, 'aconst_null'],
  [0x02, 'iconst_m1'],
  [0x03, 'iconst_0'],
  [0x04, 'iconst_1'],
  [0x05, 'iconst_2'],
  [0x06, 'iconst_3'],
  [0x07, 'iconst_4'],
  [0x08, 'iconst_5'],
  [0x10, 'bipush'],
  [0x11, 'sipush'],
  [0x12, 'ldc'],
  [0x13, 'ldc_w'],
  [0x15, 'iload'],
  [0x19, 'aload'],
  [0x1a, 'iload_0'],
  [0x1b, 'iload_1'],
  [0x1c, 'iload_2'],
  [0x1d, 'iload_3'],
  [0x2a, 'aload_0'],
  [0x2b, 'aload_1'],
  [0x2c, 'aload_2'],
  [0x2d, 'aload_3'],
  [0x2e, 'iaload'],
  [0x36, 'istore'],
  [0x3a, 'astore'],
  [0x3b, 'istore_0'],
  [0x3c, 'istore_1'],
  [0x3d, 'istore_2'],
  [0x3e, 'istore_3'],
  [0x4b, 'astore_0'],
  [0x4c, 'astore_1'],
  [0x4d, 'astore_2'],
  [0x4e, 'astore_3'],
  [0x4f, 'iastore'],
  [0x57, 'pop'],
  [0x58, 'pop2'],
  [0x59, 'dup'],
  [0x5a, 'dup_x1'],
  [0x5c, 'dup2'],
  [0x5d, 'dup2_x1'],
  [0x5f, 'swap'],
  [0x60, 'iadd'],
  [0x64, 'isub'],
  [0x68, 'imul'],
  [0x6c, 'idiv'],
  [0x70, 'irem'],
  [0x74, 'ineg'],
  [0x78, 'ishl'],
  [0x7a, 'ishr'],
  [0x7c, 'iushr'],
  [0x7e, 'iand'],
  [0x80, 'ior'],
  [0x82, 'ixor'],
  [0x84, 'iinc'],
  [0x91, 'i2b'],
  [0x92, 'i2c'],
  [0x93, 'i2s'],
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
  [0xa5, 'if_acmpeq'],
  [0xa6, 'if_acmpne'],
  [0xa7, 'goto'],
  [0xaa, 'tableswitch'],
  [0xab, 'lookupswitch'],
  [0xac, 'ireturn'],
  [0xb0, 'areturn'],
  [0xb1, 'return'],
  [0xb2, 'getstatic'],
  [0xb4, 'getfield'],
  [0xb5, 'putfield'],
  [0xb6, 'invokevirtual'],
  [0xb7, 'invokespecial'],
  [0xb8, 'invokestatic'],
  [0xbb, 'new'],
  [0xbc, 'newarray'],
  [0xbe, 'arraylength'],
  [0xbf, 'athrow'],
  [0xc6, 'ifnull'],
  [0xc7, 'ifnonnull'],
];

const HIGHEST_ASSIGNED_OPCODE = 0xca;
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
        const variableLength = info.opcode === 0xaa || info.opcode === 0xab;
        expect(info.operandBytes === undefined).toBe(variableLength);
        expect(info.operandBytes ?? 0).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(info.operandBytes ?? 0)).toBe(true);
      }
    }
  });
});

describe('opcode classification', () => {
  it('marks exactly the executable subset as supported', () => {
    const supported = [...OPCODES.values()]
      .filter((info) => info.kind === 'supported')
      .map((info) => [info.opcode, info.mnemonic] as const)
      .sort((a, b) => a[0] - b[0]);

    expect(supported).toEqual(EXECUTABLE_OPCODES);
    expect(supported).toHaveLength(90);
  });

  it('classifies `wide` as a prefix', () => {
    const variableLength = [...OPCODES.values()]
      .filter((info) => info.kind === 'variable-length')
      .map((info) => info.mnemonic);

    expect(variableLength).toEqual(['wide']);
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

  it('decodes the instructions it cannot execute just as completely', () => {
    expect(infoFor(0xb9)).toEqual({
      kind: 'unsupported',
      opcode: 0xb9,
      mnemonic: 'invokeinterface',
      operandBytes: 4,
      operands: [
        { type: 'u2', role: 'constant-pool-index' },
        { type: 'u1', role: 'argument-count' },
        { type: 'u1', role: 'mandated-zero' },
      ],
    });
    expect(infoFor(0xc5)).toMatchObject({ mnemonic: 'multianewarray', operandBytes: 3 });
    expect(isSupportedOpcode(0xb9)).toBe(false);
    expect(isSupportedOpcode(0xb7)).toBe(true);
  });

  it('gives every assigned opcode but the reserved three an operand encoding', () => {
    for (const info of OPCODES.values()) {
      const encoded = info.operands.reduce(
        (total, operand) => total + operandWidth(operand.type),
        0,
      );
      if (info.kind === 'reserved' || info.opcode === 0xaa || info.opcode === 0xab) {
        expect(info.operands, `${info.mnemonic} takes no fixed operands`).toEqual([]);
      } else if (info.kind === 'variable-length') {
        expect(info.operands).toEqual([]);
      } else {
        expect(encoded, `operand encoding of ${info.mnemonic}`).toBe(info.operandBytes);
      }
    }
  });
});

describe('operand encoding of supported opcodes', () => {
  it('agrees with the declared operand byte count', () => {
    for (const info of OPCODES.values()) {
      if (info.kind !== 'supported') {
        continue;
      }
      if (info.operandBytes === undefined) {
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
    expect(encodingOf(0x19)).toEqual([['u1', 'local-index']]);
    expect(encodingOf(0x3a)).toEqual([['u1', 'local-index']]);
  });

  it('reads the newarray atype as an unsigned byte naming a primitive type', () => {
    expect(encodingOf(0xbc)).toEqual([['u1', 'array-type']]);
    expect(arrayTypeName(T_INT)).toBe('int');
    expect(arrayTypeName(11)).toBe('long');
    expect(arrayTypeName(3)).toBeUndefined();
    expect(arrayTypeName(12)).toBeUndefined();
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
    for (const opcode of [0x00, 0x01, 0x04, 0x1a, 0x2a, 0x2e, 0x3c, 0x4c, 0x4f, 0x60, 0xac, 0xb1]) {
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

  it('describes the array instructions by the operands JVMS §6.5 lists for them', () => {
    expect(infoFor(0xbc)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 1 } });
    expect(infoFor(0xbe)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 1 } });
    expect(infoFor(0x2e)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 2, pushes: 1 } });
    expect(infoFor(0x4f)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 3, pushes: 0 } });
    expect(infoFor(0x01)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x19)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x2a)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 0, pushes: 1 } });
    expect(infoFor(0x3a)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 0 } });
    expect(infoFor(0x4b)).toMatchObject({ stackEffect: { kind: 'fixed', pops: 1, pushes: 0 } });
  });

  it('marks calls and returns as varying', () => {
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
    expect(operandWidth('i4')).toBe(4);
  });
});

describe('WIDENED_FORMS', () => {
  it('holds exactly the instructions wide may prefix (JVMS §6.5, wide)', () => {
    expect([...WIDENED_FORMS.values()].map((form) => form.mnemonic).sort()).toEqual([
      'aload_w',
      'astore_w',
      'dload_w',
      'dstore_w',
      'fload_w',
      'fstore_w',
      'iinc_w',
      'iload_w',
      'istore_w',
      'lload_w',
      'lstore_w',
      'ret_w',
    ]);
  });

  it('widens the local index to two bytes and keeps the iinc constant signed', () => {
    expect(WIDENED_FORMS.get(0x15)).toEqual({
      opcode: 0x15,
      mnemonic: 'iload_w',
      operands: [{ type: 'u2', role: 'local-index' }],
      operandBytes: 2,
      unsupported: false,
    });
    expect(WIDENED_FORMS.get(0x84)).toEqual({
      opcode: 0x84,
      mnemonic: 'iinc_w',
      operands: [
        { type: 'u2', role: 'local-index' },
        { type: 'i2', role: 'immediate' },
      ],
      operandBytes: 4,
      unsupported: false,
    });
  });

  it('carries the support of the instruction it widens', () => {
    expect(WIDENED_FORMS.get(0x16)?.unsupported).toBe(true);
    expect(WIDENED_FORMS.get(0xa9)?.unsupported).toBe(true);
  });
});
