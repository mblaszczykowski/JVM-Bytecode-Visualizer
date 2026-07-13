/**
 * Opcode metadata for the whole JVM instruction set (JVMS §6.5), kept as data rather than a
 * switch so the decoder, the interpreter and the UI all read the same table.
 *
 * Every assigned opcode carries a mnemonic and an operand byte count, which is enough to list
 * and skip an instruction nobody here understands. The MVP subset carries more: an operand
 * encoding (width, signedness, role) and a stack effect.
 */

/** Operand width and signedness as written in the JVMS instruction format. */
export type OperandType = 'u1' | 'i1' | 'u2' | 'i2';

export type OperandRole = 'local-index' | 'constant-pool-index' | 'immediate' | 'branch-offset';

export interface OperandSpec {
  readonly type: OperandType;
  readonly role: OperandRole;
}

/**
 * Net effect on the operand stack. `varies` covers instructions whose effect depends on
 * something outside the instruction itself (method descriptor, frame state).
 */
export type StackEffect =
  | { readonly kind: 'fixed'; readonly pops: number; readonly pushes: number }
  | { readonly kind: 'varies' };

interface OpcodeBase {
  readonly opcode: number;
  readonly mnemonic: string;
}

/** Instruction inside the MVP subset: fully decoded and executable by the interpreter. */
export interface SupportedOpcode extends OpcodeBase {
  readonly kind: 'supported';
  /** Sum of the widths of `operands`. */
  readonly operandBytes: number;
  readonly operands: readonly OperandSpec[];
  readonly stackEffect: StackEffect;
}

/**
 * Fixed-length instruction outside the MVP subset. Its operands are skipped by length,
 * never interpreted, so decoding survives it; executing it is a VM error.
 */
export interface UnsupportedOpcode extends OpcodeBase {
  readonly kind: 'unsupported';
  readonly operandBytes: number;
}

/**
 * `tableswitch`, `lookupswitch` and `wide` — length depends on operands (and, for the
 * switches, on 0–3 bytes of padding). Decoding cannot continue past one of them.
 */
export interface VariableLengthOpcode extends OpcodeBase {
  readonly kind: 'variable-length';
}

/** `breakpoint`/`impdep1`/`impdep2` — reserved for JVM internals, never in a valid class file. */
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
    default:
      operandType satisfies never;
      return 0;
  }
}

/** Length marker for instructions that cannot be skipped by a constant number of bytes. */
const VARIABLE_LENGTH = 'variable';

type OpcodeRow = readonly [
  opcode: number,
  mnemonic: string,
  operandBytes: number | typeof VARIABLE_LENGTH,
];

/** Mnemonic and operand byte count of every assigned opcode — JVMS §6.5, §7. */
const OPCODE_ROWS: readonly OpcodeRow[] = [
  [0x00, 'nop', 0],
  [0x01, 'aconst_null', 0],
  [0x02, 'iconst_m1', 0],
  [0x03, 'iconst_0', 0],
  [0x04, 'iconst_1', 0],
  [0x05, 'iconst_2', 0],
  [0x06, 'iconst_3', 0],
  [0x07, 'iconst_4', 0],
  [0x08, 'iconst_5', 0],
  [0x09, 'lconst_0', 0],
  [0x0a, 'lconst_1', 0],
  [0x0b, 'fconst_0', 0],
  [0x0c, 'fconst_1', 0],
  [0x0d, 'fconst_2', 0],
  [0x0e, 'dconst_0', 0],
  [0x0f, 'dconst_1', 0],
  [0x10, 'bipush', 1],
  [0x11, 'sipush', 2],
  [0x12, 'ldc', 1],
  [0x13, 'ldc_w', 2],
  [0x14, 'ldc2_w', 2],
  [0x15, 'iload', 1],
  [0x16, 'lload', 1],
  [0x17, 'fload', 1],
  [0x18, 'dload', 1],
  [0x19, 'aload', 1],
  [0x1a, 'iload_0', 0],
  [0x1b, 'iload_1', 0],
  [0x1c, 'iload_2', 0],
  [0x1d, 'iload_3', 0],
  [0x1e, 'lload_0', 0],
  [0x1f, 'lload_1', 0],
  [0x20, 'lload_2', 0],
  [0x21, 'lload_3', 0],
  [0x22, 'fload_0', 0],
  [0x23, 'fload_1', 0],
  [0x24, 'fload_2', 0],
  [0x25, 'fload_3', 0],
  [0x26, 'dload_0', 0],
  [0x27, 'dload_1', 0],
  [0x28, 'dload_2', 0],
  [0x29, 'dload_3', 0],
  [0x2a, 'aload_0', 0],
  [0x2b, 'aload_1', 0],
  [0x2c, 'aload_2', 0],
  [0x2d, 'aload_3', 0],
  [0x2e, 'iaload', 0],
  [0x2f, 'laload', 0],
  [0x30, 'faload', 0],
  [0x31, 'daload', 0],
  [0x32, 'aaload', 0],
  [0x33, 'baload', 0],
  [0x34, 'caload', 0],
  [0x35, 'saload', 0],
  [0x36, 'istore', 1],
  [0x37, 'lstore', 1],
  [0x38, 'fstore', 1],
  [0x39, 'dstore', 1],
  [0x3a, 'astore', 1],
  [0x3b, 'istore_0', 0],
  [0x3c, 'istore_1', 0],
  [0x3d, 'istore_2', 0],
  [0x3e, 'istore_3', 0],
  [0x3f, 'lstore_0', 0],
  [0x40, 'lstore_1', 0],
  [0x41, 'lstore_2', 0],
  [0x42, 'lstore_3', 0],
  [0x43, 'fstore_0', 0],
  [0x44, 'fstore_1', 0],
  [0x45, 'fstore_2', 0],
  [0x46, 'fstore_3', 0],
  [0x47, 'dstore_0', 0],
  [0x48, 'dstore_1', 0],
  [0x49, 'dstore_2', 0],
  [0x4a, 'dstore_3', 0],
  [0x4b, 'astore_0', 0],
  [0x4c, 'astore_1', 0],
  [0x4d, 'astore_2', 0],
  [0x4e, 'astore_3', 0],
  [0x4f, 'iastore', 0],
  [0x50, 'lastore', 0],
  [0x51, 'fastore', 0],
  [0x52, 'dastore', 0],
  [0x53, 'aastore', 0],
  [0x54, 'bastore', 0],
  [0x55, 'castore', 0],
  [0x56, 'sastore', 0],
  [0x57, 'pop', 0],
  [0x58, 'pop2', 0],
  [0x59, 'dup', 0],
  [0x5a, 'dup_x1', 0],
  [0x5b, 'dup_x2', 0],
  [0x5c, 'dup2', 0],
  [0x5d, 'dup2_x1', 0],
  [0x5e, 'dup2_x2', 0],
  [0x5f, 'swap', 0],
  [0x60, 'iadd', 0],
  [0x61, 'ladd', 0],
  [0x62, 'fadd', 0],
  [0x63, 'dadd', 0],
  [0x64, 'isub', 0],
  [0x65, 'lsub', 0],
  [0x66, 'fsub', 0],
  [0x67, 'dsub', 0],
  [0x68, 'imul', 0],
  [0x69, 'lmul', 0],
  [0x6a, 'fmul', 0],
  [0x6b, 'dmul', 0],
  [0x6c, 'idiv', 0],
  [0x6d, 'ldiv', 0],
  [0x6e, 'fdiv', 0],
  [0x6f, 'ddiv', 0],
  [0x70, 'irem', 0],
  [0x71, 'lrem', 0],
  [0x72, 'frem', 0],
  [0x73, 'drem', 0],
  [0x74, 'ineg', 0],
  [0x75, 'lneg', 0],
  [0x76, 'fneg', 0],
  [0x77, 'dneg', 0],
  [0x78, 'ishl', 0],
  [0x79, 'lshl', 0],
  [0x7a, 'ishr', 0],
  [0x7b, 'lshr', 0],
  [0x7c, 'iushr', 0],
  [0x7d, 'lushr', 0],
  [0x7e, 'iand', 0],
  [0x7f, 'land', 0],
  [0x80, 'ior', 0],
  [0x81, 'lor', 0],
  [0x82, 'ixor', 0],
  [0x83, 'lxor', 0],
  [0x84, 'iinc', 2],
  [0x85, 'i2l', 0],
  [0x86, 'i2f', 0],
  [0x87, 'i2d', 0],
  [0x88, 'l2i', 0],
  [0x89, 'l2f', 0],
  [0x8a, 'l2d', 0],
  [0x8b, 'f2i', 0],
  [0x8c, 'f2l', 0],
  [0x8d, 'f2d', 0],
  [0x8e, 'd2i', 0],
  [0x8f, 'd2l', 0],
  [0x90, 'd2f', 0],
  [0x91, 'i2b', 0],
  [0x92, 'i2c', 0],
  [0x93, 'i2s', 0],
  [0x94, 'lcmp', 0],
  [0x95, 'fcmpl', 0],
  [0x96, 'fcmpg', 0],
  [0x97, 'dcmpl', 0],
  [0x98, 'dcmpg', 0],
  [0x99, 'ifeq', 2],
  [0x9a, 'ifne', 2],
  [0x9b, 'iflt', 2],
  [0x9c, 'ifge', 2],
  [0x9d, 'ifgt', 2],
  [0x9e, 'ifle', 2],
  [0x9f, 'if_icmpeq', 2],
  [0xa0, 'if_icmpne', 2],
  [0xa1, 'if_icmplt', 2],
  [0xa2, 'if_icmpge', 2],
  [0xa3, 'if_icmpgt', 2],
  [0xa4, 'if_icmple', 2],
  [0xa5, 'if_acmpeq', 2],
  [0xa6, 'if_acmpne', 2],
  [0xa7, 'goto', 2],
  [0xa8, 'jsr', 2],
  [0xa9, 'ret', 1],
  [0xaa, 'tableswitch', VARIABLE_LENGTH],
  [0xab, 'lookupswitch', VARIABLE_LENGTH],
  [0xac, 'ireturn', 0],
  [0xad, 'lreturn', 0],
  [0xae, 'freturn', 0],
  [0xaf, 'dreturn', 0],
  [0xb0, 'areturn', 0],
  [0xb1, 'return', 0],
  [0xb2, 'getstatic', 2],
  [0xb3, 'putstatic', 2],
  [0xb4, 'getfield', 2],
  [0xb5, 'putfield', 2],
  [0xb6, 'invokevirtual', 2],
  [0xb7, 'invokespecial', 2],
  [0xb8, 'invokestatic', 2],
  [0xb9, 'invokeinterface', 4],
  [0xba, 'invokedynamic', 4],
  [0xbb, 'new', 2],
  [0xbc, 'newarray', 1],
  [0xbd, 'anewarray', 2],
  [0xbe, 'arraylength', 0],
  [0xbf, 'athrow', 0],
  [0xc0, 'checkcast', 2],
  [0xc1, 'instanceof', 2],
  [0xc2, 'monitorenter', 0],
  [0xc3, 'monitorexit', 0],
  [0xc4, 'wide', VARIABLE_LENGTH],
  [0xc5, 'multianewarray', 3],
  [0xc6, 'ifnull', 2],
  [0xc7, 'ifnonnull', 2],
  [0xc8, 'goto_w', 4],
  [0xc9, 'jsr_w', 4],
  // Reserved opcodes — JVMS §6.2.
  [0xca, 'breakpoint', 0],
  [0xfe, 'impdep1', 0],
  [0xff, 'impdep2', 0],
];

const RESERVED_OPCODES: ReadonlySet<number> = new Set([0xca, 0xfe, 0xff]);

const NO_OPERANDS: readonly OperandSpec[] = [];
const LOCAL_INDEX: readonly OperandSpec[] = [{ type: 'u1', role: 'local-index' }];
const IMMEDIATE_BYTE: readonly OperandSpec[] = [{ type: 'i1', role: 'immediate' }];
const IMMEDIATE_SHORT: readonly OperandSpec[] = [{ type: 'i2', role: 'immediate' }];
const BRANCH_OFFSET: readonly OperandSpec[] = [{ type: 'i2', role: 'branch-offset' }];
const CONSTANT_POOL_INDEX: readonly OperandSpec[] = [{ type: 'u2', role: 'constant-pool-index' }];
/** `iinc`: unsigned local slot, then a signed increment (JVMS §6.5 iinc). */
const IINC_OPERANDS: readonly OperandSpec[] = [
  { type: 'u1', role: 'local-index' },
  { type: 'i1', role: 'immediate' },
];

function fixed(pops: number, pushes: number): StackEffect {
  return { kind: 'fixed', pops, pushes };
}

const VARIES: StackEffect = { kind: 'varies' };

interface MvpSpec {
  readonly operands: readonly OperandSpec[];
  readonly stackEffect: StackEffect;
}

const PUSH_CONSTANT: MvpSpec = { operands: NO_OPERANDS, stackEffect: fixed(0, 1) };
const LOAD_LOCAL_N: MvpSpec = { operands: NO_OPERANDS, stackEffect: fixed(0, 1) };
const STORE_LOCAL_N: MvpSpec = { operands: NO_OPERANDS, stackEffect: fixed(1, 0) };
const BINARY_ARITHMETIC: MvpSpec = { operands: NO_OPERANDS, stackEffect: fixed(2, 1) };
const BRANCH_ON_INT: MvpSpec = { operands: BRANCH_OFFSET, stackEffect: fixed(1, 0) };
const BRANCH_ON_INT_PAIR: MvpSpec = { operands: BRANCH_OFFSET, stackEffect: fixed(2, 0) };

/** The MVP instruction subset: everything the interpreter executes, and nothing else. */
const MVP_SPECS = new Map<number, MvpSpec>([
  // Constants.
  [0x00, { operands: NO_OPERANDS, stackEffect: fixed(0, 0) }], // nop
  [0x02, PUSH_CONSTANT], // iconst_m1
  [0x03, PUSH_CONSTANT], // iconst_0
  [0x04, PUSH_CONSTANT], // iconst_1
  [0x05, PUSH_CONSTANT], // iconst_2
  [0x06, PUSH_CONSTANT], // iconst_3
  [0x07, PUSH_CONSTANT], // iconst_4
  [0x08, PUSH_CONSTANT], // iconst_5
  [0x10, { operands: IMMEDIATE_BYTE, stackEffect: fixed(0, 1) }], // bipush
  [0x11, { operands: IMMEDIATE_SHORT, stackEffect: fixed(0, 1) }], // sipush

  // Loads and stores.
  [0x15, { operands: LOCAL_INDEX, stackEffect: fixed(0, 1) }], // iload
  [0x1a, LOAD_LOCAL_N], // iload_0
  [0x1b, LOAD_LOCAL_N], // iload_1
  [0x1c, LOAD_LOCAL_N], // iload_2
  [0x1d, LOAD_LOCAL_N], // iload_3
  [0x36, { operands: LOCAL_INDEX, stackEffect: fixed(1, 0) }], // istore
  [0x3b, STORE_LOCAL_N], // istore_0
  [0x3c, STORE_LOCAL_N], // istore_1
  [0x3d, STORE_LOCAL_N], // istore_2
  [0x3e, STORE_LOCAL_N], // istore_3
  [0x84, { operands: IINC_OPERANDS, stackEffect: fixed(0, 0) }], // iinc

  // Operand stack.
  [0x57, { operands: NO_OPERANDS, stackEffect: fixed(1, 0) }], // pop
  [0x59, { operands: NO_OPERANDS, stackEffect: fixed(1, 2) }], // dup

  // Arithmetic.
  [0x60, BINARY_ARITHMETIC], // iadd
  [0x64, BINARY_ARITHMETIC], // isub
  [0x68, BINARY_ARITHMETIC], // imul
  [0x6c, BINARY_ARITHMETIC], // idiv
  [0x70, BINARY_ARITHMETIC], // irem
  [0x74, { operands: NO_OPERANDS, stackEffect: fixed(1, 1) }], // ineg

  // Conditional branches.
  [0x99, BRANCH_ON_INT], // ifeq
  [0x9a, BRANCH_ON_INT], // ifne
  [0x9b, BRANCH_ON_INT], // iflt
  [0x9c, BRANCH_ON_INT], // ifge
  [0x9d, BRANCH_ON_INT], // ifgt
  [0x9e, BRANCH_ON_INT], // ifle
  [0x9f, BRANCH_ON_INT_PAIR], // if_icmpeq
  [0xa0, BRANCH_ON_INT_PAIR], // if_icmpne
  [0xa1, BRANCH_ON_INT_PAIR], // if_icmplt
  [0xa2, BRANCH_ON_INT_PAIR], // if_icmpge
  [0xa3, BRANCH_ON_INT_PAIR], // if_icmpgt
  [0xa4, BRANCH_ON_INT_PAIR], // if_icmple

  // Unconditional branch.
  [0xa7, { operands: BRANCH_OFFSET, stackEffect: fixed(0, 0) }], // goto

  // Calls and returns: the stack effect depends on the method descriptor / caller frame.
  [0xac, { operands: NO_OPERANDS, stackEffect: VARIES }], // ireturn
  [0xb1, { operands: NO_OPERANDS, stackEffect: VARIES }], // return
  [0xb8, { operands: CONSTANT_POOL_INDEX, stackEffect: VARIES }], // invokestatic
]);

function toOpcodeInfo([opcode, mnemonic, operandBytes]: OpcodeRow): OpcodeInfo {
  if (operandBytes === VARIABLE_LENGTH) {
    return { kind: 'variable-length', opcode, mnemonic };
  }
  if (RESERVED_OPCODES.has(opcode)) {
    return { kind: 'reserved', opcode, mnemonic };
  }
  const spec = MVP_SPECS.get(opcode);
  if (spec === undefined) {
    return { kind: 'unsupported', opcode, mnemonic, operandBytes };
  }
  return {
    kind: 'supported',
    opcode,
    mnemonic,
    operandBytes,
    operands: spec.operands,
    stackEffect: spec.stackEffect,
  };
}

/** Every assigned opcode, keyed by its byte value. Unassigned bytes are absent. */
export const OPCODES: ReadonlyMap<number, OpcodeInfo> = new Map(
  OPCODE_ROWS.map((row) => [row[0], toOpcodeInfo(row)]),
);

/** `undefined` for the unassigned bytes 0xcb–0xfd (and anything outside 0–255). */
export function lookupOpcode(opcode: number): OpcodeInfo | undefined {
  return OPCODES.get(opcode);
}

export function isSupportedOpcode(opcode: number): boolean {
  return OPCODES.get(opcode)?.kind === 'supported';
}
