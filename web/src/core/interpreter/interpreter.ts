import {
  ConstantTag,
  isClassFileError,
  isStatic,
  parseMethodDescriptor,
  type ClassFile,
  type CodeAttribute,
  type ConstantPool,
  type ConstantPoolEntry,
  type JvmReturnType,
  type MethodDescriptor,
  type MethodInfo,
} from '../classfile';
import { arrayTypeName, lookupOpcode, T_INT, type Instruction } from '../disassembler';
import { isVmFault, toVmError, VmFault } from './errors';
import {
  createFrame,
  loadLocal,
  peekAny,
  pop,
  popAny,
  prepareMethod,
  push,
  setPc,
  storeLocal,
  type Frame,
  type PreparedMethod,
} from './frame';
import { Heap, NULL_REFERENCE } from './heap';
import { iadd, idiv, imul, ineg, irem, isub } from './int32';
import { createTerminalSnapshot, SnapshotWriter, sourceLineAt } from './snapshot';
import {
  DEFAULT_MAX_CALL_DEPTH,
  DEFAULT_MAX_STEPS,
  type ExecuteOptions,
  type ExecutionResult,
  type Snapshot,
  type ValueKind,
} from './types';

/**
 * Fetch-decode-execute over a `.class` file, recording one snapshot per executed instruction
 * (the state *before* it runs) plus a terminal one.
 *
 * The program runs to completion up front and the caller replays the history, so this is a
 * pure, deterministic function: same class file, same result. It never throws — every
 * failure comes back as an `ExecutionResult`.
 */
export function execute(classFile: ClassFile, options: ExecuteOptions = {}): ExecutionResult {
  const maxSteps = atLeastOne(options.maxSteps, DEFAULT_MAX_STEPS);
  const entryName = options.entryMethod ?? DEFAULT_ENTRY_METHOD;

  const entry = findEntryMethod(classFile, entryName);
  if (entry === undefined) {
    return {
      kind: 'vm-error',
      snapshots: Object.freeze([]),
      error: {
        kind: 'unsupported-call',
        target: `${classFile.thisClassName}.${entryName}`,
        offset: 0,
        methodName: entryName,
      },
    };
  }

  const snapshots: Snapshot[] = [];
  const writer = new SnapshotWriter();
  const prepared = new Map<MethodInfo, PreparedMethod>();

  let entryFrame: Frame;
  try {
    // Preparing the entry method is the one step outside the run loop that can fault (an
    // unverifiable branch target), so it needs the same handling — without this `execute()`
    // would throw a `VmFault` at its caller instead of returning a result.
    entryFrame = createFrame(prepare(prepared, entry.method, entry.code), []);
  } catch (error) {
    return failedRun(error, snapshots, 0, entry.method.name);
  }

  const machine: Machine = {
    classFile,
    prepared,
    maxCallDepth: atLeastOne(options.maxCallDepth, DEFAULT_MAX_CALL_DEPTH),
    callStack: [entryFrame],
    heap: new Heap(),
    returnValue: undefined,
  };

  for (;;) {
    const frame = machine.callStack.at(-1);
    if (frame === undefined) {
      break;
    }
    if (snapshots.length >= maxSteps) {
      return { kind: 'step-limit', snapshots: Object.freeze(snapshots), limit: maxSteps };
    }

    const offset = frame.pc;
    try {
      const fetched = fetchAt(frame);
      snapshots.push(
        writer.next(
          snapshots.length,
          machine.callStack,
          machine.heap,
          fetched.instruction,
          sourceLineAt(frame),
        ),
      );
      // Advance before dispatching: a call pushed by this instruction must leave the caller
      // pointing at its continuation, which is where the frame resumes after the callee returns.
      setPc(frame, fetched.nextOffset);
      step(machine, frame, fetched.instruction);
    } catch (error) {
      return failedRun(error, snapshots, offset, frame.method.name);
    }
  }

  snapshots.push(createTerminalSnapshot(snapshots.length, machine.heap));
  return {
    kind: 'completed',
    snapshots: Object.freeze(snapshots),
    ...(machine.returnValue === undefined ? {} : { returnValue: machine.returnValue }),
  };
}

export const DEFAULT_ENTRY_METHOD = 'main';

/**
 * A stopped run, with the history collected so far. Anything that is not a `VmFault` is a bug
 * in the interpreter rather than in the bytecode, and is rethrown rather than dressed up.
 */
function failedRun(
  error: unknown,
  snapshots: readonly Snapshot[],
  offset: number,
  methodName: string,
): ExecutionResult {
  if (!isVmFault(error)) {
    throw error;
  }
  const location = error.location ?? { offset, methodName };
  return {
    kind: 'vm-error',
    snapshots: Object.freeze(snapshots),
    error: toVmError(error.detail, location.offset, location.methodName),
  };
}

/** A limit of zero would produce an empty history, which reads as "nothing happened". */
function atLeastOne(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Entry points the interpreter can start from. The `String[]` of `main` stays an empty slot
 * — nothing in the subset can allocate that array — and the no-argument forms exist so a
 * single method can be run directly.
 */
const ENTRY_DESCRIPTORS: ReadonlySet<string> = new Set(['([Ljava/lang/String;)V', '()V', '()I']);

/** The executable subset of JVMS §6.5, as a union type so the dispatch switch stays exhaustive. */
const Op = {
  nop: 0x00,
  aconst_null: 0x01,
  iconst_m1: 0x02,
  iconst_0: 0x03,
  iconst_1: 0x04,
  iconst_2: 0x05,
  iconst_3: 0x06,
  iconst_4: 0x07,
  iconst_5: 0x08,
  bipush: 0x10,
  sipush: 0x11,
  iload: 0x15,
  aload: 0x19,
  iload_0: 0x1a,
  iload_1: 0x1b,
  iload_2: 0x1c,
  iload_3: 0x1d,
  aload_0: 0x2a,
  aload_1: 0x2b,
  aload_2: 0x2c,
  aload_3: 0x2d,
  iaload: 0x2e,
  istore: 0x36,
  astore: 0x3a,
  istore_0: 0x3b,
  istore_1: 0x3c,
  istore_2: 0x3d,
  istore_3: 0x3e,
  astore_0: 0x4b,
  astore_1: 0x4c,
  astore_2: 0x4d,
  astore_3: 0x4e,
  iastore: 0x4f,
  pop: 0x57,
  dup: 0x59,
  iadd: 0x60,
  isub: 0x64,
  imul: 0x68,
  idiv: 0x6c,
  irem: 0x70,
  ineg: 0x74,
  iinc: 0x84,
  ifeq: 0x99,
  ifne: 0x9a,
  iflt: 0x9b,
  ifge: 0x9c,
  ifgt: 0x9d,
  ifle: 0x9e,
  if_icmpeq: 0x9f,
  if_icmpne: 0xa0,
  if_icmplt: 0xa1,
  if_icmpge: 0xa2,
  if_icmpgt: 0xa3,
  if_icmple: 0xa4,
  goto: 0xa7,
  ireturn: 0xac,
  return: 0xb1,
  invokestatic: 0xb8,
  newarray: 0xbc,
  arraylength: 0xbe,
} as const;

type Op = (typeof Op)[keyof typeof Op];

/** Opcodes `execute()` can run; everything else ends the run with `unsupported-opcode`. */
export const EXECUTABLE_OPCODES: ReadonlySet<number> = new Set<number>(Object.values(Op));

function isExecutable(opcode: number): opcode is Op {
  return EXECUTABLE_OPCODES.has(opcode);
}

interface Machine {
  readonly classFile: ClassFile;
  readonly prepared: Map<MethodInfo, PreparedMethod>;
  readonly maxCallDepth: number;
  readonly callStack: Frame[];
  /** Shared by every frame of the run, and never unwound (JVMS §2.5.3). */
  readonly heap: Heap;
  /** Set when the entry frame returns a value — the result of the whole run. */
  returnValue: number | undefined;
}

function fetchAt(frame: Frame): { readonly instruction: Instruction; readonly nextOffset: number } {
  const fetched = frame.method.flow.get(frame.pc);
  if (fetched === undefined) {
    throw undecodable(frame);
  }
  return fetched;
}

/**
 * No instruction starts at `pc`: either execution fell off the end of the method, or it
 * reached bytes the disassembler refused to decode (a variable-length instruction, a
 * reserved opcode, an operand cut short by the end of `code[]`). The opcode byte still
 * names the instruction, which is what the user needs to see.
 */
function undecodable(frame: Frame): VmFault {
  const opcode = frame.method.code.code[frame.pc];
  if (opcode === undefined) {
    return new VmFault({
      kind: 'invalid-state',
      message: `execution ran past the end of ${frame.method.name}()`,
    });
  }
  return new VmFault({
    kind: 'unsupported-opcode',
    mnemonic: lookupOpcode(opcode)?.mnemonic ?? `0x${opcode.toString(16).padStart(2, '0')}`,
  });
}

function step(machine: Machine, frame: Frame, instruction: Instruction): void {
  const { opcode } = instruction;
  if (!isExecutable(opcode)) {
    throw new VmFault({ kind: 'unsupported-opcode', mnemonic: instruction.mnemonic });
  }

  switch (opcode) {
    case Op.nop:
      break;

    case Op.aconst_null:
      push(frame, NULL_REFERENCE, 'ref');
      break;
    case Op.iconst_m1:
      push(frame, -1, 'int');
      break;
    case Op.iconst_0:
      push(frame, 0, 'int');
      break;
    case Op.iconst_1:
      push(frame, 1, 'int');
      break;
    case Op.iconst_2:
      push(frame, 2, 'int');
      break;
    case Op.iconst_3:
      push(frame, 3, 'int');
      break;
    case Op.iconst_4:
      push(frame, 4, 'int');
      break;
    case Op.iconst_5:
      push(frame, 5, 'int');
      break;
    case Op.bipush:
    case Op.sipush:
      push(frame, operand(instruction, 0), 'int');
      break;

    case Op.iload:
      pushLocal(frame, operand(instruction, 0), 'int');
      break;
    case Op.iload_0:
      pushLocal(frame, 0, 'int');
      break;
    case Op.iload_1:
      pushLocal(frame, 1, 'int');
      break;
    case Op.iload_2:
      pushLocal(frame, 2, 'int');
      break;
    case Op.iload_3:
      pushLocal(frame, 3, 'int');
      break;
    case Op.aload:
      pushLocal(frame, operand(instruction, 0), 'ref');
      break;
    case Op.aload_0:
      pushLocal(frame, 0, 'ref');
      break;
    case Op.aload_1:
      pushLocal(frame, 1, 'ref');
      break;
    case Op.aload_2:
      pushLocal(frame, 2, 'ref');
      break;
    case Op.aload_3:
      pushLocal(frame, 3, 'ref');
      break;
    case Op.istore:
      popIntoLocal(frame, operand(instruction, 0), 'int');
      break;
    case Op.istore_0:
      popIntoLocal(frame, 0, 'int');
      break;
    case Op.istore_1:
      popIntoLocal(frame, 1, 'int');
      break;
    case Op.istore_2:
      popIntoLocal(frame, 2, 'int');
      break;
    case Op.istore_3:
      popIntoLocal(frame, 3, 'int');
      break;
    case Op.astore:
      popIntoLocal(frame, operand(instruction, 0), 'ref');
      break;
    case Op.astore_0:
      popIntoLocal(frame, 0, 'ref');
      break;
    case Op.astore_1:
      popIntoLocal(frame, 1, 'ref');
      break;
    case Op.astore_2:
      popIntoLocal(frame, 2, 'ref');
      break;
    case Op.astore_3:
      popIntoLocal(frame, 3, 'ref');
      break;
    case Op.iinc: {
      // Increments the slot in place — the operand stack is not touched, which is why every
      // `for` loop needs this instruction.
      const slot = operand(instruction, 0);
      storeLocal(frame, slot, iadd(loadLocal(frame, slot, 'int'), operand(instruction, 1)), 'int');
      break;
    }

    case Op.newarray:
      allocateArray(machine, frame, operand(instruction, 0));
      break;
    case Op.arraylength:
      push(frame, machine.heap.lengthOf(pop(frame, 'ref')), 'int');
      break;
    case Op.iaload: {
      // JVMS §6.5 iaload: `…, arrayref, index → …, value`, so the index comes off first.
      const index = pop(frame, 'int');
      const arrayref = pop(frame, 'ref');
      push(frame, machine.heap.loadInt(arrayref, index), 'int');
      break;
    }
    case Op.iastore: {
      // JVMS §6.5 iastore: `…, arrayref, index, value →`, popped in reverse of that order.
      const value = pop(frame, 'int');
      const index = pop(frame, 'int');
      const arrayref = pop(frame, 'ref');
      machine.heap.storeInt(arrayref, index, value);
      break;
    }

    case Op.pop:
      popAny(frame);
      break;
    case Op.dup: {
      // Type-agnostic (JVMS §6.5 dup): duplicating a reference must not turn it into an int.
      const top = peekAny(frame);
      push(frame, top.value, top.kind);
      break;
    }

    case Op.iadd:
      binary(frame, iadd);
      break;
    case Op.isub:
      binary(frame, isub);
      break;
    case Op.imul:
      binary(frame, imul);
      break;
    case Op.idiv:
      divide(frame, idiv);
      break;
    case Op.irem:
      divide(frame, irem);
      break;
    case Op.ineg:
      push(frame, ineg(pop(frame, 'int')), 'int');
      break;

    case Op.ifeq:
      branchIf(frame, instruction, equal(pop(frame, 'int'), 0));
      break;
    case Op.ifne:
      branchIf(frame, instruction, notEqual(pop(frame, 'int'), 0));
      break;
    case Op.iflt:
      branchIf(frame, instruction, less(pop(frame, 'int'), 0));
      break;
    case Op.ifge:
      branchIf(frame, instruction, greaterOrEqual(pop(frame, 'int'), 0));
      break;
    case Op.ifgt:
      branchIf(frame, instruction, greater(pop(frame, 'int'), 0));
      break;
    case Op.ifle:
      branchIf(frame, instruction, lessOrEqual(pop(frame, 'int'), 0));
      break;
    case Op.if_icmpeq:
      branchIf(frame, instruction, comparePair(frame, equal));
      break;
    case Op.if_icmpne:
      branchIf(frame, instruction, comparePair(frame, notEqual));
      break;
    case Op.if_icmplt:
      branchIf(frame, instruction, comparePair(frame, less));
      break;
    case Op.if_icmpge:
      branchIf(frame, instruction, comparePair(frame, greaterOrEqual));
      break;
    case Op.if_icmpgt:
      branchIf(frame, instruction, comparePair(frame, greater));
      break;
    case Op.if_icmple:
      branchIf(frame, instruction, comparePair(frame, lessOrEqual));
      break;
    case Op.goto:
      setPc(frame, branchTargetOf(instruction));
      break;

    case Op.invokestatic:
      invokeStatic(machine, frame, operand(instruction, 0));
      break;
    case Op.ireturn:
      returnFromFrame(machine, pop(frame, 'int'));
      break;
    case Op.return:
      returnFromFrame(machine, undefined);
      break;

    default:
      opcode satisfies never;
      break;
  }
}

/** `iload`/`aload`: the slot must already hold a value of the kind the instruction reads. */
function pushLocal(frame: Frame, slot: number, kind: ValueKind): void {
  push(frame, loadLocal(frame, slot, kind), kind);
}

/** `istore`/`astore`: what the instruction takes off the stack is what the slot then holds. */
function popIntoLocal(frame: Frame, slot: number, kind: ValueKind): void {
  storeLocal(frame, slot, pop(frame, kind), kind);
}

/**
 * JVMS §6.5 newarray: `…, count → …, arrayref`.
 *
 * The element type is fixed by the instruction rather than by the stack, so it is rejected
 * before anything is popped — a `long[]` is not a program this interpreter can continue.
 */
function allocateArray(machine: Machine, frame: Frame, atype: number): void {
  if (atype !== T_INT) {
    const element = arrayTypeName(atype);
    throw new VmFault({
      kind: 'unsupported-array-type',
      typeName: element === undefined ? `atype ${String(atype)}` : `${element}[]`,
    });
  }
  const count = pop(frame, 'int');
  push(frame, machine.heap.allocateIntArray(count), 'ref');
}

type IntComparison = (value1: number, value2: number) => boolean;

const equal: IntComparison = (value1, value2) => value1 === value2;
const notEqual: IntComparison = (value1, value2) => value1 !== value2;
const less: IntComparison = (value1, value2) => value1 < value2;
const greaterOrEqual: IntComparison = (value1, value2) => value1 >= value2;
const greater: IntComparison = (value1, value2) => value1 > value2;
const lessOrEqual: IntComparison = (value1, value2) => value1 <= value2;

/** JVMS §6.5 if_icmp<cond>: the stack holds `…, value1, value2`, so value2 comes off first. */
function comparePair(frame: Frame, holds: IntComparison): boolean {
  const value2 = pop(frame, 'int');
  const value1 = pop(frame, 'int');
  return holds(value1, value2);
}

function binary(frame: Frame, apply: (value1: number, value2: number) => number): void {
  const value2 = pop(frame, 'int');
  const value1 = pop(frame, 'int');
  push(frame, apply(value1, value2), 'int');
}

function divide(frame: Frame, apply: (dividend: number, divisor: number) => number): void {
  const divisor = pop(frame, 'int');
  const dividend = pop(frame, 'int');
  if (divisor === 0) {
    throw new VmFault({ kind: 'division-by-zero' });
  }
  push(frame, apply(dividend, divisor), 'int');
}

function branchIf(frame: Frame, instruction: Instruction, taken: boolean): void {
  if (taken) {
    setPc(frame, branchTargetOf(instruction));
  }
}

/** Absolute target, already resolved by the disassembler from the signed delta (JVMS §6.5). */
function branchTargetOf(instruction: Instruction): number {
  const { branchTarget } = instruction;
  if (branchTarget === undefined) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `${instruction.mnemonic} without a branch target`,
    });
  }
  return branchTarget;
}

function returnFromFrame(machine: Machine, value: number | undefined): void {
  machine.callStack.pop();
  if (value === undefined) {
    return;
  }
  const caller = machine.callStack.at(-1);
  if (caller === undefined) {
    machine.returnValue = value;
    return;
  }
  // Only `ireturn` carries a value, and only int-returning methods are callable.
  push(caller, value, 'int');
}

function invokeStatic(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);
  const target = `${reference.className}.${reference.name}${reference.descriptor}`;
  if (reference.className !== machine.classFile.thisClassName) {
    throw new VmFault({ kind: 'unsupported-call', target });
  }

  const parameterCount = intParameterCount(reference.descriptor);
  const method = findMethod(machine.classFile, reference.name, reference.descriptor);
  const code = method?.code;
  if (
    parameterCount === undefined ||
    method === undefined ||
    code === undefined ||
    !isStatic(method.accessFlags)
  ) {
    throw new VmFault({ kind: 'unsupported-call', target });
  }
  // Recursion without a base case would otherwise grow the history until the tab dies; a real
  // JVM answers the same situation with StackOverflowError (JVMS §2.6.2).
  if (machine.callStack.length >= machine.maxCallDepth) {
    throw new VmFault({ kind: 'stack-overflow', limit: machine.maxCallDepth });
  }

  // Arguments were pushed left to right, so they come off the stack in reverse order.
  const args = new Array<number>(parameterCount);
  for (let index = parameterCount - 1; index >= 0; index -= 1) {
    args[index] = pop(frame, 'int');
  }
  machine.callStack.push(createFrame(prepare(machine.prepared, method, code), args));
}

function prepare(
  cache: Map<MethodInfo, PreparedMethod>,
  method: MethodInfo,
  code: CodeAttribute,
): PreparedMethod {
  const cached = cache.get(method);
  if (cached !== undefined) {
    return cached;
  }
  const prepared = prepareMethod(method, code);
  cache.set(method, prepared);
  return prepared;
}

function findMethod(
  classFile: ClassFile,
  name: string,
  descriptor: string,
): MethodInfo | undefined {
  return classFile.methods.find(
    (method) => method.name === name && method.descriptor === descriptor,
  );
}

export interface EntryPoint {
  readonly method: MethodInfo;
  readonly code: CodeAttribute;
}

/**
 * The method a run starts from. Exported because the rule — static, with a Code attribute and
 * one of `ENTRY_DESCRIPTORS` — decides what the UI may offer as runnable; matching on the name
 * alone would list a method the interpreter then refuses to execute.
 */
export function findEntryMethod(
  classFile: ClassFile,
  name: string = DEFAULT_ENTRY_METHOD,
): EntryPoint | undefined {
  for (const method of classFile.methods) {
    const { code } = method;
    if (method.name === name && code !== undefined && isEntryMethod(method)) {
      return { method, code };
    }
  }
  return undefined;
}

/** Whether `execute()` could start from this method, its name aside. */
export function isEntryMethod(method: MethodInfo): boolean {
  return (
    method.code !== undefined &&
    isStatic(method.accessFlags) &&
    ENTRY_DESCRIPTORS.has(method.descriptor)
  );
}

/** Parameter count, or `undefined` for a descriptor outside the MVP subset `(I*)I|V`. */
function intParameterCount(descriptor: string): number | undefined {
  const parsed = parseDescriptor(descriptor);
  if (parsed === undefined) {
    return undefined;
  }
  const returnsIntOrVoid = parsed.returnType.kind === 'void' || isIntType(parsed.returnType);
  if (!returnsIntOrVoid || !parsed.params.every(isIntType)) {
    return undefined;
  }
  return parsed.params.length;
}

function parseDescriptor(descriptor: string): MethodDescriptor | undefined {
  try {
    return parseMethodDescriptor(descriptor);
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    // A descriptor the class file itself got wrong — there is nothing callable behind it.
    return undefined;
  }
}

function isIntType(type: JvmReturnType): boolean {
  return type.kind === 'primitive' && type.name === 'int';
}

function operand(instruction: Instruction, index: number): number {
  const value = instruction.operands[index];
  if (value === undefined) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `${instruction.mnemonic} is missing operand ${String(index)}`,
    });
  }
  return value;
}

interface MethodReference {
  readonly className: string;
  readonly name: string;
  readonly descriptor: string;
}

/** JVMS §4.4.2: Methodref → Class + NameAndType, all of them Utf8 in the end. */
function resolveMethodref(pool: ConstantPool, index: number): MethodReference {
  const reference = poolEntry(pool, index);
  if (reference?.tag !== ConstantTag.Methodref) {
    throw badPoolEntry(index, 'Methodref');
  }
  const owner = poolEntry(pool, reference.classIndex);
  if (owner?.tag !== ConstantTag.Class) {
    throw badPoolEntry(reference.classIndex, 'Class');
  }
  const nameAndType = poolEntry(pool, reference.nameAndTypeIndex);
  if (nameAndType?.tag !== ConstantTag.NameAndType) {
    throw badPoolEntry(reference.nameAndTypeIndex, 'NameAndType');
  }

  return {
    className: utf8(pool, owner.nameIndex),
    name: utf8(pool, nameAndType.nameIndex),
    descriptor: utf8(pool, nameAndType.descriptorIndex),
  };
}

function poolEntry(pool: ConstantPool, index: number): ConstantPoolEntry | undefined {
  return pool[index] ?? undefined;
}

function utf8(pool: ConstantPool, index: number): string {
  const entry = poolEntry(pool, index);
  if (entry?.tag !== ConstantTag.Utf8) {
    throw badPoolEntry(index, 'Utf8');
  }
  return entry.value;
}

function badPoolEntry(index: number, expected: string): VmFault {
  return new VmFault({
    kind: 'invalid-state',
    message: `constant pool entry #${String(index)} is not a ${expected}`,
  });
}
