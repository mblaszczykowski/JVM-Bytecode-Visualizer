export type OperandType = 'u1' | 'i1' | 'u2' | 'i2' | 'i4';

export type OperandRole =
  | 'local-index'
  | 'constant-pool-index'
  | 'immediate'
  | 'branch-offset'
  | 'array-type'
  | 'dimensions'
  | 'argument-count'
  | 'mandated-zero';

export interface OperandSpec {
  readonly type: OperandType;
  readonly role: OperandRole;
}

export type StackEffect =
  | { readonly kind: 'fixed'; readonly pops: number; readonly pushes: number }
  | { readonly kind: 'varies' };

interface OpcodeBase {
  readonly opcode: number;
  readonly mnemonic: string;
  readonly operands: readonly OperandSpec[];
}

export interface SupportedOpcode extends OpcodeBase {
  readonly kind: 'supported';
  readonly operandBytes?: number;
  readonly stackEffect: StackEffect;
}

export interface UnsupportedOpcode extends OpcodeBase {
  readonly kind: 'unsupported';
  readonly operandBytes: number;
}

export interface VariableLengthOpcode extends OpcodeBase {
  readonly kind: 'variable-length';
}

export interface ReservedOpcode extends OpcodeBase {
  readonly kind: 'reserved';
}

export type OpcodeInfo =
  SupportedOpcode | UnsupportedOpcode | VariableLengthOpcode | ReservedOpcode;

export function operandWidth(operandType: OperandType): number {
  switch (operandType) {
    case 'u1':
    case 'i1':
      return 1;
    case 'u2':
    case 'i2':
      return 2;
    case 'i4':
      return 4;
    default:
      operandType satisfies never;
      return 0;
  }
}

const NO_OPERANDS: readonly OperandSpec[] = [];
const LOCAL_INDEX: readonly OperandSpec[] = [{ type: 'u1', role: 'local-index' }];
const IMMEDIATE_BYTE: readonly OperandSpec[] = [{ type: 'i1', role: 'immediate' }];
const IMMEDIATE_SHORT: readonly OperandSpec[] = [{ type: 'i2', role: 'immediate' }];
const BRANCH_OFFSET: readonly OperandSpec[] = [{ type: 'i2', role: 'branch-offset' }];
const WIDE_BRANCH_OFFSET: readonly OperandSpec[] = [{ type: 'i4', role: 'branch-offset' }];
const CONSTANT_POOL_INDEX: readonly OperandSpec[] = [{ type: 'u2', role: 'constant-pool-index' }];
const NARROW_CONSTANT_POOL_INDEX: readonly OperandSpec[] = [
  { type: 'u1', role: 'constant-pool-index' },
];
const ARRAY_TYPE: readonly OperandSpec[] = [{ type: 'u1', role: 'array-type' }];
const IINC_OPERANDS: readonly OperandSpec[] = [
  { type: 'u1', role: 'local-index' },
  { type: 'i1', role: 'immediate' },
];
const MULTIANEWARRAY_OPERANDS: readonly OperandSpec[] = [
  { type: 'u2', role: 'constant-pool-index' },
  { type: 'u1', role: 'dimensions' },
];
const INVOKEINTERFACE_OPERANDS: readonly OperandSpec[] = [
  { type: 'u2', role: 'constant-pool-index' },
  { type: 'u1', role: 'argument-count' },
  { type: 'u1', role: 'mandated-zero' },
];
const INVOKEDYNAMIC_OPERANDS: readonly OperandSpec[] = [
  { type: 'u2', role: 'constant-pool-index' },
  { type: 'u1', role: 'mandated-zero' },
  { type: 'u1', role: 'mandated-zero' },
];

const VARIABLE_LENGTH = 'variable';

type OpcodeRow = readonly [
  opcode: number,
  mnemonic: string,
  operands: readonly OperandSpec[] | typeof VARIABLE_LENGTH,
];

const OPCODE_ROWS: readonly OpcodeRow[] = [
  [0x00, 'nop', NO_OPERANDS],
  [0x01, 'aconst_null', NO_OPERANDS],
  [0x02, 'iconst_m1', NO_OPERANDS],
  [0x03, 'iconst_0', NO_OPERANDS],
  [0x04, 'iconst_1', NO_OPERANDS],
  [0x05, 'iconst_2', NO_OPERANDS],
  [0x06, 'iconst_3', NO_OPERANDS],
  [0x07, 'iconst_4', NO_OPERANDS],
  [0x08, 'iconst_5', NO_OPERANDS],
  [0x09, 'lconst_0', NO_OPERANDS],
  [0x0a, 'lconst_1', NO_OPERANDS],
  [0x0b, 'fconst_0', NO_OPERANDS],
  [0x0c, 'fconst_1', NO_OPERANDS],
  [0x0d, 'fconst_2', NO_OPERANDS],
  [0x0e, 'dconst_0', NO_OPERANDS],
  [0x0f, 'dconst_1', NO_OPERANDS],
  [0x10, 'bipush', IMMEDIATE_BYTE],
  [0x11, 'sipush', IMMEDIATE_SHORT],
  [0x12, 'ldc', NARROW_CONSTANT_POOL_INDEX],
  [0x13, 'ldc_w', CONSTANT_POOL_INDEX],
  [0x14, 'ldc2_w', CONSTANT_POOL_INDEX],
  [0x15, 'iload', LOCAL_INDEX],
  [0x16, 'lload', LOCAL_INDEX],
  [0x17, 'fload', LOCAL_INDEX],
  [0x18, 'dload', LOCAL_INDEX],
  [0x19, 'aload', LOCAL_INDEX],
  [0x1a, 'iload_0', NO_OPERANDS],
  [0x1b, 'iload_1', NO_OPERANDS],
  [0x1c, 'iload_2', NO_OPERANDS],
  [0x1d, 'iload_3', NO_OPERANDS],
  [0x1e, 'lload_0', NO_OPERANDS],
  [0x1f, 'lload_1', NO_OPERANDS],
  [0x20, 'lload_2', NO_OPERANDS],
  [0x21, 'lload_3', NO_OPERANDS],
  [0x22, 'fload_0', NO_OPERANDS],
  [0x23, 'fload_1', NO_OPERANDS],
  [0x24, 'fload_2', NO_OPERANDS],
  [0x25, 'fload_3', NO_OPERANDS],
  [0x26, 'dload_0', NO_OPERANDS],
  [0x27, 'dload_1', NO_OPERANDS],
  [0x28, 'dload_2', NO_OPERANDS],
  [0x29, 'dload_3', NO_OPERANDS],
  [0x2a, 'aload_0', NO_OPERANDS],
  [0x2b, 'aload_1', NO_OPERANDS],
  [0x2c, 'aload_2', NO_OPERANDS],
  [0x2d, 'aload_3', NO_OPERANDS],
  [0x2e, 'iaload', NO_OPERANDS],
  [0x2f, 'laload', NO_OPERANDS],
  [0x30, 'faload', NO_OPERANDS],
  [0x31, 'daload', NO_OPERANDS],
  [0x32, 'aaload', NO_OPERANDS],
  [0x33, 'baload', NO_OPERANDS],
  [0x34, 'caload', NO_OPERANDS],
  [0x35, 'saload', NO_OPERANDS],
  [0x36, 'istore', LOCAL_INDEX],
  [0x37, 'lstore', LOCAL_INDEX],
  [0x38, 'fstore', LOCAL_INDEX],
  [0x39, 'dstore', LOCAL_INDEX],
  [0x3a, 'astore', LOCAL_INDEX],
  [0x3b, 'istore_0', NO_OPERANDS],
  [0x3c, 'istore_1', NO_OPERANDS],
  [0x3d, 'istore_2', NO_OPERANDS],
  [0x3e, 'istore_3', NO_OPERANDS],
  [0x3f, 'lstore_0', NO_OPERANDS],
  [0x40, 'lstore_1', NO_OPERANDS],
  [0x41, 'lstore_2', NO_OPERANDS],
  [0x42, 'lstore_3', NO_OPERANDS],
  [0x43, 'fstore_0', NO_OPERANDS],
  [0x44, 'fstore_1', NO_OPERANDS],
  [0x45, 'fstore_2', NO_OPERANDS],
  [0x46, 'fstore_3', NO_OPERANDS],
  [0x47, 'dstore_0', NO_OPERANDS],
  [0x48, 'dstore_1', NO_OPERANDS],
  [0x49, 'dstore_2', NO_OPERANDS],
  [0x4a, 'dstore_3', NO_OPERANDS],
  [0x4b, 'astore_0', NO_OPERANDS],
  [0x4c, 'astore_1', NO_OPERANDS],
  [0x4d, 'astore_2', NO_OPERANDS],
  [0x4e, 'astore_3', NO_OPERANDS],
  [0x4f, 'iastore', NO_OPERANDS],
  [0x50, 'lastore', NO_OPERANDS],
  [0x51, 'fastore', NO_OPERANDS],
  [0x52, 'dastore', NO_OPERANDS],
  [0x53, 'aastore', NO_OPERANDS],
  [0x54, 'bastore', NO_OPERANDS],
  [0x55, 'castore', NO_OPERANDS],
  [0x56, 'sastore', NO_OPERANDS],
  [0x57, 'pop', NO_OPERANDS],
  [0x58, 'pop2', NO_OPERANDS],
  [0x59, 'dup', NO_OPERANDS],
  [0x5a, 'dup_x1', NO_OPERANDS],
  [0x5b, 'dup_x2', NO_OPERANDS],
  [0x5c, 'dup2', NO_OPERANDS],
  [0x5d, 'dup2_x1', NO_OPERANDS],
  [0x5e, 'dup2_x2', NO_OPERANDS],
  [0x5f, 'swap', NO_OPERANDS],
  [0x60, 'iadd', NO_OPERANDS],
  [0x61, 'ladd', NO_OPERANDS],
  [0x62, 'fadd', NO_OPERANDS],
  [0x63, 'dadd', NO_OPERANDS],
  [0x64, 'isub', NO_OPERANDS],
  [0x65, 'lsub', NO_OPERANDS],
  [0x66, 'fsub', NO_OPERANDS],
  [0x67, 'dsub', NO_OPERANDS],
  [0x68, 'imul', NO_OPERANDS],
  [0x69, 'lmul', NO_OPERANDS],
  [0x6a, 'fmul', NO_OPERANDS],
  [0x6b, 'dmul', NO_OPERANDS],
  [0x6c, 'idiv', NO_OPERANDS],
  [0x6d, 'ldiv', NO_OPERANDS],
  [0x6e, 'fdiv', NO_OPERANDS],
  [0x6f, 'ddiv', NO_OPERANDS],
  [0x70, 'irem', NO_OPERANDS],
  [0x71, 'lrem', NO_OPERANDS],
  [0x72, 'frem', NO_OPERANDS],
  [0x73, 'drem', NO_OPERANDS],
  [0x74, 'ineg', NO_OPERANDS],
  [0x75, 'lneg', NO_OPERANDS],
  [0x76, 'fneg', NO_OPERANDS],
  [0x77, 'dneg', NO_OPERANDS],
  [0x78, 'ishl', NO_OPERANDS],
  [0x79, 'lshl', NO_OPERANDS],
  [0x7a, 'ishr', NO_OPERANDS],
  [0x7b, 'lshr', NO_OPERANDS],
  [0x7c, 'iushr', NO_OPERANDS],
  [0x7d, 'lushr', NO_OPERANDS],
  [0x7e, 'iand', NO_OPERANDS],
  [0x7f, 'land', NO_OPERANDS],
  [0x80, 'ior', NO_OPERANDS],
  [0x81, 'lor', NO_OPERANDS],
  [0x82, 'ixor', NO_OPERANDS],
  [0x83, 'lxor', NO_OPERANDS],
  [0x84, 'iinc', IINC_OPERANDS],
  [0x85, 'i2l', NO_OPERANDS],
  [0x86, 'i2f', NO_OPERANDS],
  [0x87, 'i2d', NO_OPERANDS],
  [0x88, 'l2i', NO_OPERANDS],
  [0x89, 'l2f', NO_OPERANDS],
  [0x8a, 'l2d', NO_OPERANDS],
  [0x8b, 'f2i', NO_OPERANDS],
  [0x8c, 'f2l', NO_OPERANDS],
  [0x8d, 'f2d', NO_OPERANDS],
  [0x8e, 'd2i', NO_OPERANDS],
  [0x8f, 'd2l', NO_OPERANDS],
  [0x90, 'd2f', NO_OPERANDS],
  [0x91, 'i2b', NO_OPERANDS],
  [0x92, 'i2c', NO_OPERANDS],
  [0x93, 'i2s', NO_OPERANDS],
  [0x94, 'lcmp', NO_OPERANDS],
  [0x95, 'fcmpl', NO_OPERANDS],
  [0x96, 'fcmpg', NO_OPERANDS],
  [0x97, 'dcmpl', NO_OPERANDS],
  [0x98, 'dcmpg', NO_OPERANDS],
  [0x99, 'ifeq', BRANCH_OFFSET],
  [0x9a, 'ifne', BRANCH_OFFSET],
  [0x9b, 'iflt', BRANCH_OFFSET],
  [0x9c, 'ifge', BRANCH_OFFSET],
  [0x9d, 'ifgt', BRANCH_OFFSET],
  [0x9e, 'ifle', BRANCH_OFFSET],
  [0x9f, 'if_icmpeq', BRANCH_OFFSET],
  [0xa0, 'if_icmpne', BRANCH_OFFSET],
  [0xa1, 'if_icmplt', BRANCH_OFFSET],
  [0xa2, 'if_icmpge', BRANCH_OFFSET],
  [0xa3, 'if_icmpgt', BRANCH_OFFSET],
  [0xa4, 'if_icmple', BRANCH_OFFSET],
  [0xa5, 'if_acmpeq', BRANCH_OFFSET],
  [0xa6, 'if_acmpne', BRANCH_OFFSET],
  [0xa7, 'goto', BRANCH_OFFSET],
  [0xa8, 'jsr', BRANCH_OFFSET],
  [0xa9, 'ret', LOCAL_INDEX],
  [0xaa, 'tableswitch', VARIABLE_LENGTH],
  [0xab, 'lookupswitch', VARIABLE_LENGTH],
  [0xac, 'ireturn', NO_OPERANDS],
  [0xad, 'lreturn', NO_OPERANDS],
  [0xae, 'freturn', NO_OPERANDS],
  [0xaf, 'dreturn', NO_OPERANDS],
  [0xb0, 'areturn', NO_OPERANDS],
  [0xb1, 'return', NO_OPERANDS],
  [0xb2, 'getstatic', CONSTANT_POOL_INDEX],
  [0xb3, 'putstatic', CONSTANT_POOL_INDEX],
  [0xb4, 'getfield', CONSTANT_POOL_INDEX],
  [0xb5, 'putfield', CONSTANT_POOL_INDEX],
  [0xb6, 'invokevirtual', CONSTANT_POOL_INDEX],
  [0xb7, 'invokespecial', CONSTANT_POOL_INDEX],
  [0xb8, 'invokestatic', CONSTANT_POOL_INDEX],
  [0xb9, 'invokeinterface', INVOKEINTERFACE_OPERANDS],
  [0xba, 'invokedynamic', INVOKEDYNAMIC_OPERANDS],
  [0xbb, 'new', CONSTANT_POOL_INDEX],
  [0xbc, 'newarray', ARRAY_TYPE],
  [0xbd, 'anewarray', CONSTANT_POOL_INDEX],
  [0xbe, 'arraylength', NO_OPERANDS],
  [0xbf, 'athrow', NO_OPERANDS],
  [0xc0, 'checkcast', CONSTANT_POOL_INDEX],
  [0xc1, 'instanceof', CONSTANT_POOL_INDEX],
  [0xc2, 'monitorenter', NO_OPERANDS],
  [0xc3, 'monitorexit', NO_OPERANDS],
  [0xc4, 'wide', VARIABLE_LENGTH],
  [0xc5, 'multianewarray', MULTIANEWARRAY_OPERANDS],
  [0xc6, 'ifnull', BRANCH_OFFSET],
  [0xc7, 'ifnonnull', BRANCH_OFFSET],
  [0xc8, 'goto_w', WIDE_BRANCH_OFFSET],
  [0xc9, 'jsr_w', WIDE_BRANCH_OFFSET],
  [0xca, 'breakpoint', NO_OPERANDS],
  [0xfe, 'impdep1', NO_OPERANDS],
  [0xff, 'impdep2', NO_OPERANDS],
];

const RESERVED_OPCODES: ReadonlySet<number> = new Set([0xca, 0xfe, 0xff]);

const TABLESWITCH = 0xaa;
export const LOOKUPSWITCH = 0xab;

function fixed(pops: number, pushes: number): StackEffect {
  return { kind: 'fixed', pops, pushes };
}

const VARIES: StackEffect = { kind: 'varies' };

const PUSH_CONSTANT = fixed(0, 1);
const LOAD_LOCAL_N = fixed(0, 1);
const STORE_LOCAL_N = fixed(1, 0);
const BINARY_ARITHMETIC = fixed(2, 1);
const UNARY_ARITHMETIC = fixed(1, 1);
const BRANCH_ON_INT = fixed(1, 0);
const BRANCH_ON_INT_PAIR = fixed(2, 0);

const STACK_EFFECTS = new Map<number, StackEffect>([
  [0x00, fixed(0, 0)],
  [0x01, PUSH_CONSTANT],
  [0x02, PUSH_CONSTANT],
  [0x03, PUSH_CONSTANT],
  [0x04, PUSH_CONSTANT],
  [0x05, PUSH_CONSTANT],
  [0x06, PUSH_CONSTANT],
  [0x07, PUSH_CONSTANT],
  [0x08, PUSH_CONSTANT],
  [0x10, PUSH_CONSTANT],
  [0x11, PUSH_CONSTANT],
  [0x12, PUSH_CONSTANT],
  [0x13, PUSH_CONSTANT],

  [0x15, fixed(0, 1)],
  [0x19, fixed(0, 1)],
  [0x1a, LOAD_LOCAL_N],
  [0x1b, LOAD_LOCAL_N],
  [0x1c, LOAD_LOCAL_N],
  [0x1d, LOAD_LOCAL_N],
  [0x2a, LOAD_LOCAL_N],
  [0x2b, LOAD_LOCAL_N],
  [0x2c, LOAD_LOCAL_N],
  [0x2d, LOAD_LOCAL_N],
  [0x36, fixed(1, 0)],
  [0x3a, fixed(1, 0)],
  [0x3b, STORE_LOCAL_N],
  [0x3c, STORE_LOCAL_N],
  [0x3d, STORE_LOCAL_N],
  [0x3e, STORE_LOCAL_N],
  [0x4b, STORE_LOCAL_N],
  [0x4c, STORE_LOCAL_N],
  [0x4d, STORE_LOCAL_N],
  [0x4e, STORE_LOCAL_N],
  [0x84, fixed(0, 0)],

  [0x2e, fixed(2, 1)],
  [0x4f, fixed(3, 0)],
  [0xbc, fixed(1, 1)],
  [0xbe, fixed(1, 1)],

  [0x57, fixed(1, 0)],
  [0x58, fixed(2, 0)],
  [0x59, fixed(1, 2)],
  [0x5a, fixed(2, 3)],
  [0x5c, fixed(2, 4)],
  [0x5d, fixed(3, 5)],
  [0x5f, fixed(2, 2)],

  [0x60, BINARY_ARITHMETIC],
  [0x64, BINARY_ARITHMETIC],
  [0x68, BINARY_ARITHMETIC],
  [0x6c, BINARY_ARITHMETIC],
  [0x70, BINARY_ARITHMETIC],
  [0x74, UNARY_ARITHMETIC],
  [0x78, BINARY_ARITHMETIC],
  [0x7a, BINARY_ARITHMETIC],
  [0x7c, BINARY_ARITHMETIC],
  [0x7e, BINARY_ARITHMETIC],
  [0x80, BINARY_ARITHMETIC],
  [0x82, BINARY_ARITHMETIC],

  [0x91, UNARY_ARITHMETIC],
  [0x92, UNARY_ARITHMETIC],
  [0x93, UNARY_ARITHMETIC],

  [0x99, BRANCH_ON_INT],
  [0x9a, BRANCH_ON_INT],
  [0x9b, BRANCH_ON_INT],
  [0x9c, BRANCH_ON_INT],
  [0x9d, BRANCH_ON_INT],
  [0x9e, BRANCH_ON_INT],
  [0x9f, BRANCH_ON_INT_PAIR],
  [0xa0, BRANCH_ON_INT_PAIR],
  [0xa1, BRANCH_ON_INT_PAIR],
  [0xa2, BRANCH_ON_INT_PAIR],
  [0xa3, BRANCH_ON_INT_PAIR],
  [0xa4, BRANCH_ON_INT_PAIR],

  [0xa7, fixed(0, 0)],
  [TABLESWITCH, fixed(1, 0)],
  [LOOKUPSWITCH, fixed(1, 0)],

  [0xa5, fixed(2, 0)],
  [0xa6, fixed(2, 0)],
  [0xc6, fixed(1, 0)],
  [0xc7, fixed(1, 0)],

  [0xac, VARIES],
  [0xb0, VARIES],
  [0xb1, VARIES],
  [0xb2, VARIES],
  [0xb4, VARIES],
  [0xb5, VARIES],
  [0xb6, VARIES],
  [0xb7, VARIES],
  [0xb8, VARIES],

  [0xbb, fixed(0, 1)],

  [0xbf, VARIES],
]);

function toOpcodeInfo([opcode, mnemonic, operands]: OpcodeRow): OpcodeInfo {
  if (RESERVED_OPCODES.has(opcode)) {
    return { kind: 'reserved', opcode, mnemonic, operands: NO_OPERANDS };
  }
  const stackEffect = STACK_EFFECTS.get(opcode);
  if (operands === VARIABLE_LENGTH) {
    return stackEffect === undefined
      ? { kind: 'variable-length', opcode, mnemonic, operands: NO_OPERANDS }
      : { kind: 'supported', opcode, mnemonic, operands: NO_OPERANDS, stackEffect };
  }

  const operandBytes = operands.reduce((total, spec) => total + operandWidth(spec.type), 0);
  if (stackEffect === undefined) {
    return { kind: 'unsupported', opcode, mnemonic, operands, operandBytes };
  }
  return { kind: 'supported', opcode, mnemonic, operands, operandBytes, stackEffect };
}

export const OPCODES: ReadonlyMap<number, OpcodeInfo> = new Map(
  OPCODE_ROWS.map((row) => [row[0], toOpcodeInfo(row)]),
);

export function lookupOpcode(opcode: number): OpcodeInfo | undefined {
  return OPCODES.get(opcode);
}

export function isSupportedOpcode(opcode: number): boolean {
  return OPCODES.get(opcode)?.kind === 'supported';
}

const WIDE_LOCAL_INDEX: readonly OperandSpec[] = [{ type: 'u2', role: 'local-index' }];
const WIDE_IINC_OPERANDS: readonly OperandSpec[] = [
  { type: 'u2', role: 'local-index' },
  { type: 'i2', role: 'immediate' },
];

export interface WidenedForm {
  readonly opcode: number;
  readonly mnemonic: string;
  readonly operands: readonly OperandSpec[];
  readonly operandBytes: number;
  readonly unsupported: boolean;
}

const WIDENABLE: readonly (readonly [opcode: number, operands: readonly OperandSpec[]])[] = [
  [0x15, WIDE_LOCAL_INDEX],
  [0x16, WIDE_LOCAL_INDEX],
  [0x17, WIDE_LOCAL_INDEX],
  [0x18, WIDE_LOCAL_INDEX],
  [0x19, WIDE_LOCAL_INDEX],
  [0x36, WIDE_LOCAL_INDEX],
  [0x37, WIDE_LOCAL_INDEX],
  [0x38, WIDE_LOCAL_INDEX],
  [0x39, WIDE_LOCAL_INDEX],
  [0x3a, WIDE_LOCAL_INDEX],
  [0xa9, WIDE_LOCAL_INDEX],
  [0x84, WIDE_IINC_OPERANDS],
];

export const WIDENED_FORMS: ReadonlyMap<number, WidenedForm> = new Map(
  WIDENABLE.map(([opcode, operands]) => {
    const info = OPCODES.get(opcode);
    return [
      opcode,
      {
        opcode,
        mnemonic: `${info?.mnemonic ?? ''}_w`,
        operands,
        operandBytes: operands.reduce((total, spec) => total + operandWidth(spec.type), 0),
        unsupported: info?.kind !== 'supported',
      },
    ];
  }),
);

const ARRAY_TYPE_NAMES: ReadonlyMap<number, string> = new Map([
  [4, 'boolean'],
  [5, 'char'],
  [6, 'float'],
  [7, 'double'],
  [8, 'byte'],
  [9, 'short'],
  [10, 'int'],
  [11, 'long'],
]);

export const T_INT = 10;

export function arrayTypeName(atype: number): string | undefined {
  return ARRAY_TYPE_NAMES.get(atype);
}
