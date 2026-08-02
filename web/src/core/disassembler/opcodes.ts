/**
 * Opcode metadata for the whole JVM instruction set (JVMS §6.5), kept as data rather than a
 * switch so the decoder, the interpreter and the UI all read the same table.
 *
 * Two facts live here and are deliberately kept apart:
 *
 *   - the *encoding* — the width, signedness and role of every operand — which every assigned
 *     opcode carries, because a listing that prints `getstatic` without its `#7` is not a
 *     listing of that instruction;
 *   - the *stack effect*, which only the opcodes the interpreter executes carry.
 *
 * An instruction can therefore be decoded completely and still not be runnable, which is the
 * normal case for a class file taken from a real project. `kind` answers the second question
 * only: `supported` means the interpreter runs it, never that the decoder understands it.
 */

/** Operand width and signedness as written in the JVMS instruction format. */
export type OperandType = 'u1' | 'i1' | 'u2' | 'i2' | 'i4';

export type OperandRole =
  | 'local-index'
  | 'constant-pool-index'
  | 'immediate'
  | 'branch-offset'
  /** The `atype` of `newarray`, which names a primitive element type rather than a number. */
  | 'array-type'
  /** Number of dimensions `multianewarray` allocates (JVMS §6.5 multianewarray). */
  | 'dimensions'
  /** `invokeinterface`'s `count`: the argument slots the call occupies, checked by the JVM. */
  | 'argument-count'
  /**
   * A byte JVMS requires to be zero (`invokeinterface`, `invokedynamic`). It carries no value
   * but it is part of the instruction, so it is decoded rather than silently skipped.
   */
  | 'mandated-zero';

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
  /**
   * The operand layout the decoder reads. Empty for `tableswitch`/`lookupswitch`, whose arms
   * are not a fixed list of operands and arrive as `Instruction.switchTargets` instead.
   */
  readonly operands: readonly OperandSpec[];
}

/** Instruction the interpreter executes. Everything the decoder knows, plus a stack effect. */
export interface SupportedOpcode extends OpcodeBase {
  readonly kind: 'supported';
  /** Sum of the widths of `operands`; absent for the two switches, which are variable-length. */
  readonly operandBytes?: number;
  readonly stackEffect: StackEffect;
}

/**
 * Instruction outside the executable subset. Decoded exactly like a supported one — the
 * listing shows the mnemonic, the operands and the constant pool references — but executing
 * it ends the run with a VM error.
 */
export interface UnsupportedOpcode extends OpcodeBase {
  readonly kind: 'unsupported';
  readonly operandBytes: number;
}

/**
 * `wide` (JVMS §6.5 wide): a modifier rather than an instruction. The decoder folds it into
 * the load, store or `iinc` it widens, so no `Instruction` ever carries opcode 0xc4 — see
 * `decodeWide` in disassembler.ts for the representation and why javap agrees with it.
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
/** JVMS §6.5 goto_w/jsr_w: the same jump with a 4-byte delta, for methods above 32 KiB. */
const WIDE_BRANCH_OFFSET: readonly OperandSpec[] = [{ type: 'i4', role: 'branch-offset' }];
const CONSTANT_POOL_INDEX: readonly OperandSpec[] = [{ type: 'u2', role: 'constant-pool-index' }];
/** `ldc` addresses only the first 255 pool entries; `ldc_w` is the same instruction widened. */
const NARROW_CONSTANT_POOL_INDEX: readonly OperandSpec[] = [
  { type: 'u1', role: 'constant-pool-index' },
];
const ARRAY_TYPE: readonly OperandSpec[] = [{ type: 'u1', role: 'array-type' }];
/** `iinc`: unsigned local slot, then a signed increment (JVMS §6.5 iinc). */
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

/** Length marker for the instructions that cannot be skipped by a constant number of bytes. */
const VARIABLE_LENGTH = 'variable';

type OpcodeRow = readonly [
  opcode: number,
  mnemonic: string,
  operands: readonly OperandSpec[] | typeof VARIABLE_LENGTH,
];

/** Mnemonic and operand encoding of every assigned opcode — JVMS §6.5, §7. */
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
  // Reserved opcodes — JVMS §6.2.
  [0xca, 'breakpoint', NO_OPERANDS],
  [0xfe, 'impdep1', NO_OPERANDS],
  [0xff, 'impdep2', NO_OPERANDS],
];

const RESERVED_OPCODES: ReadonlySet<number> = new Set([0xca, 0xfe, 0xff]);

/** The two switches: variable-length, yet executed — their arms arrive as `switchTargets`. */
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

/**
 * The executable subset: an opcode is in this table exactly when `execute()` runs it, and the
 * value is what it does to the operand stack. Membership — not the encoding above — is what
 * `kind: 'supported'` and `Instruction.unsupported` report.
 */
const STACK_EFFECTS = new Map<number, StackEffect>([
  // Constants.
  [0x00, fixed(0, 0)], // nop
  [0x01, PUSH_CONSTANT], // aconst_null
  [0x02, PUSH_CONSTANT], // iconst_m1
  [0x03, PUSH_CONSTANT], // iconst_0
  [0x04, PUSH_CONSTANT], // iconst_1
  [0x05, PUSH_CONSTANT], // iconst_2
  [0x06, PUSH_CONSTANT], // iconst_3
  [0x07, PUSH_CONSTANT], // iconst_4
  [0x08, PUSH_CONSTANT], // iconst_5
  [0x10, PUSH_CONSTANT], // bipush
  [0x11, PUSH_CONSTANT], // sipush
  [0x12, PUSH_CONSTANT], // ldc
  [0x13, PUSH_CONSTANT], // ldc_w

  // Loads and stores.
  [0x15, fixed(0, 1)], // iload
  [0x19, fixed(0, 1)], // aload
  [0x1a, LOAD_LOCAL_N], // iload_0
  [0x1b, LOAD_LOCAL_N], // iload_1
  [0x1c, LOAD_LOCAL_N], // iload_2
  [0x1d, LOAD_LOCAL_N], // iload_3
  [0x2a, LOAD_LOCAL_N], // aload_0
  [0x2b, LOAD_LOCAL_N], // aload_1
  [0x2c, LOAD_LOCAL_N], // aload_2
  [0x2d, LOAD_LOCAL_N], // aload_3
  [0x36, fixed(1, 0)], // istore
  [0x3a, fixed(1, 0)], // astore
  [0x3b, STORE_LOCAL_N], // istore_0
  [0x3c, STORE_LOCAL_N], // istore_1
  [0x3d, STORE_LOCAL_N], // istore_2
  [0x3e, STORE_LOCAL_N], // istore_3
  [0x4b, STORE_LOCAL_N], // astore_0
  [0x4c, STORE_LOCAL_N], // astore_1
  [0x4d, STORE_LOCAL_N], // astore_2
  [0x4e, STORE_LOCAL_N], // astore_3
  [0x84, fixed(0, 0)], // iinc

  // Arrays: `…, arrayref, index → …, value` and `…, arrayref, index, value →` (JVMS §6.5).
  [0x2e, fixed(2, 1)], // iaload
  [0x4f, fixed(3, 0)], // iastore
  [0xbc, fixed(1, 1)], // newarray
  [0xbe, fixed(1, 1)], // arraylength

  // Operand stack. Only the category-1 forms exist here — see the interpreter's `dup2`.
  [0x57, fixed(1, 0)], // pop
  [0x58, fixed(2, 0)], // pop2
  [0x59, fixed(1, 2)], // dup
  [0x5a, fixed(2, 3)], // dup_x1
  [0x5c, fixed(2, 4)], // dup2
  [0x5d, fixed(3, 5)], // dup2_x1
  [0x5f, fixed(2, 2)], // swap

  // Arithmetic, shifts and bitwise logic.
  [0x60, BINARY_ARITHMETIC], // iadd
  [0x64, BINARY_ARITHMETIC], // isub
  [0x68, BINARY_ARITHMETIC], // imul
  [0x6c, BINARY_ARITHMETIC], // idiv
  [0x70, BINARY_ARITHMETIC], // irem
  [0x74, UNARY_ARITHMETIC], // ineg
  [0x78, BINARY_ARITHMETIC], // ishl
  [0x7a, BINARY_ARITHMETIC], // ishr
  [0x7c, BINARY_ARITHMETIC], // iushr
  [0x7e, BINARY_ARITHMETIC], // iand
  [0x80, BINARY_ARITHMETIC], // ior
  [0x82, BINARY_ARITHMETIC], // ixor

  // Narrowing conversions, which change the value but not the number of slots.
  [0x91, UNARY_ARITHMETIC], // i2b
  [0x92, UNARY_ARITHMETIC], // i2c
  [0x93, UNARY_ARITHMETIC], // i2s

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

  // Unconditional branch and the two switches, which consume the value they dispatch on.
  [0xa7, fixed(0, 0)], // goto
  [TABLESWITCH, fixed(1, 0)],
  [LOOKUPSWITCH, fixed(1, 0)],

  // Calls, field reads and returns: the descriptor or the caller frame decides the effect.
  [0xac, VARIES], // ireturn
  [0xb1, VARIES], // return
  [0xb2, VARIES], // getstatic
  [0xb6, VARIES], // invokevirtual
  [0xb8, VARIES], // invokestatic

  // `athrow` empties the operand stack and leaves the exception alone on it (JVMS §2.10) —
  // or the frame does not survive to have one, and the effect belongs to a frame further down.
  [0xbf, VARIES], // athrow
]);

function toOpcodeInfo([opcode, mnemonic, operands]: OpcodeRow): OpcodeInfo {
  if (RESERVED_OPCODES.has(opcode)) {
    return { kind: 'reserved', opcode, mnemonic, operands: NO_OPERANDS };
  }
  const stackEffect = STACK_EFFECTS.get(opcode);
  if (operands === VARIABLE_LENGTH) {
    // `wide` is the only variable-length opcode with no stack effect of its own: it is a
    // prefix, and the instruction it widens carries the effect.
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

/** Every assigned opcode, keyed by its byte value. Unassigned bytes are absent. */
export const OPCODES: ReadonlyMap<number, OpcodeInfo> = new Map(
  OPCODE_ROWS.map((row) => [row[0], toOpcodeInfo(row)]),
);

/** `undefined` for the unassigned bytes 0xcb–0xfd (and anything outside 0–255). */
export function lookupOpcode(opcode: number): OpcodeInfo | undefined {
  return OPCODES.get(opcode);
}

/** Whether the interpreter executes this opcode — not whether the decoder understands it. */
export function isSupportedOpcode(opcode: number): boolean {
  return OPCODES.get(opcode)?.kind === 'supported';
}

/** JVMS §6.5 wide: the local index becomes `u2`, and `iinc`'s constant becomes `i2`. */
const WIDE_LOCAL_INDEX: readonly OperandSpec[] = [{ type: 'u2', role: 'local-index' }];
const WIDE_IINC_OPERANDS: readonly OperandSpec[] = [
  { type: 'u2', role: 'local-index' },
  { type: 'i2', role: 'immediate' },
];

/** The instruction a `wide` prefix produces, ready to be listed on its own row. */
export interface WidenedForm {
  readonly opcode: number;
  /** javap prints the widened form with a `_w` suffix: `iload_w`, `iinc_w`. */
  readonly mnemonic: string;
  readonly operands: readonly OperandSpec[];
  readonly operandBytes: number;
  readonly unsupported: boolean;
}

/** The twelve instructions `wide` may prefix; any other byte after it is not an instruction. */
const WIDENABLE: readonly (readonly [opcode: number, operands: readonly OperandSpec[]])[] = [
  [0x15, WIDE_LOCAL_INDEX], // iload
  [0x16, WIDE_LOCAL_INDEX], // lload
  [0x17, WIDE_LOCAL_INDEX], // fload
  [0x18, WIDE_LOCAL_INDEX], // dload
  [0x19, WIDE_LOCAL_INDEX], // aload
  [0x36, WIDE_LOCAL_INDEX], // istore
  [0x37, WIDE_LOCAL_INDEX], // lstore
  [0x38, WIDE_LOCAL_INDEX], // fstore
  [0x39, WIDE_LOCAL_INDEX], // dstore
  [0x3a, WIDE_LOCAL_INDEX], // astore
  [0xa9, WIDE_LOCAL_INDEX], // ret
  [0x84, WIDE_IINC_OPERANDS], // iinc
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

/** JVMS §6.5 newarray: the `atype` operand codes the primitive element type. */
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

/** The one element type this project allocates; every other `atype` is a VM error. */
export const T_INT = 10;

/** Element type of a `newarray` atype, or `undefined` for a code JVMS does not assign. */
export function arrayTypeName(atype: number): string | undefined {
  return ARRAY_TYPE_NAMES.get(atype);
}
