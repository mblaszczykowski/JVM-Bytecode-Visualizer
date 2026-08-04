import {
  ConstantTag,
  isClassFileError,
  isStatic,
  parseMethodDescriptor,
  type ClassFile,
  type CodeAttribute,
  type ConstantPool,
  type ConstantPoolEntry,
  type ExceptionTableEntry,
  type JvmReturnType,
  type MethodDescriptor,
  type MethodInfo,
} from '../classfile';
import { arrayTypeName, lookupOpcode, T_INT, type Instruction } from '../disassembler';
import { ConsoleOutput } from './console';
import { isVmFault, thrownBy, toVmError, VmFault, type VmFaultDetail } from './errors';
import {
  EXTERNAL_FIELDS,
  EXTERNAL_METHODS,
  ExternalPool,
  memberKey,
  stringConstant,
  type ExternalArgument,
  type ExternalMethod,
} from './externals';
import {
  clearOperandStack,
  createFrame,
  loadLocal,
  loadReference,
  peekAny,
  pop,
  popAny,
  popReference,
  prepareMethod,
  push,
  setPc,
  storeLocal,
  type Frame,
  type PreparedMethod,
  type StackValue,
} from './frame';
import { Heap, NULL_REFERENCE } from './heap';
import {
  i2b,
  i2c,
  i2s,
  iadd,
  iand,
  idiv,
  imul,
  ineg,
  ior,
  irem,
  ishl,
  ishr,
  isub,
  iushr,
  ixor,
} from './int32';
import {
  createTerminalSnapshot,
  SnapshotWriter,
  sourceLineAt,
  type MachineState,
} from './snapshot';
import { catches, isThrowableClass } from './throwable';
import {
  DEFAULT_MAX_CALL_DEPTH,
  DEFAULT_MAX_STEPS,
  type ExecuteOptions,
  type ExecutionResult,
  type ExternalValue,
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
    console: new ConsoleOutput(),
    externals: new ExternalPool(),
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
          machine,
          fetched.instruction,
          sourceLineAt(frame),
        ),
      );
      // Advance before dispatching: a call pushed by this instruction must leave the caller
      // pointing at its continuation, which is where the frame resumes after the callee returns.
      frame.currentPc = offset;
      setPc(frame, fetched.nextOffset);
      step(machine, frame, fetched.instruction);
    } catch (error) {
      // A fault that names a Java exception is not the end of the run until the whole call
      // stack has been asked whether it wants it (JVMS §2.10).
      if (
        isVmFault(error) &&
        error.location === undefined &&
        dispatchThrow(machine, error.detail)
      ) {
        continue;
      }
      return failedRun(error, snapshots, offset, frame.method.name);
    }
  }

  snapshots.push(createTerminalSnapshot(snapshots.length, machine));
  return {
    kind: 'completed',
    snapshots: Object.freeze(snapshots),
    ...(machine.returnValue === undefined ? {} : { returnValue: machine.returnValue }),
  };
}

export const DEFAULT_ENTRY_METHOD = 'main';

/**
 * Hands an exception to the first handler on the call stack that wants it, unwinding frames
 * that have none (JVMS §2.10). `true` when the machine may carry on, `false` when the stack
 * ran out and the exception is uncaught — at which point the call stack has been emptied,
 * which is precisely what a real JVM does before the run ends.
 *
 * The frames popped on the way are gone from the next snapshot, so the reader watches the
 * stack unwind rather than being told that it did.
 */
function dispatchThrow(machine: Machine, detail: VmFaultDetail): boolean {
  const thrown = thrownBy(detail);
  if (thrown === undefined) {
    return false;
  }
  // Interned once and carried by handle, so a rethrow, a handler's local slot and the panel
  // all name the same object.
  const handle =
    thrown.handle ?? machine.externals.intern({ className: thrown.className, label: thrown.label });

  for (
    let frame = machine.callStack.at(-1);
    frame !== undefined;
    frame = machine.callStack.at(-1)
  ) {
    const handler = handlerFor(frame, thrown.className);
    if (handler !== undefined) {
      clearOperandStack(frame);
      push(frame, handle, 'external');
      setPc(frame, handler.handlerPc);
      frame.currentPc = handler.handlerPc;
      return true;
    }
    machine.callStack.pop();
  }
  return false;
}

/**
 * The first row of this frame's exception table that covers the offset being executed and
 * catches the class thrown. Row order is the source order of the `catch` clauses, so the
 * first match is the one Java picks.
 */
function handlerFor(frame: Frame, thrownClass: string): ExceptionTableEntry | undefined {
  return frame.method.code.exceptionTable?.find(
    (entry) =>
      frame.currentPc >= entry.startPc &&
      frame.currentPc < entry.endPc &&
      catches(entry.catchType, thrownClass),
  );
}

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
  ldc: 0x12,
  ldc_w: 0x13,
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
  pop2: 0x58,
  dup: 0x59,
  dup_x1: 0x5a,
  dup2: 0x5c,
  dup2_x1: 0x5d,
  swap: 0x5f,
  iadd: 0x60,
  isub: 0x64,
  imul: 0x68,
  idiv: 0x6c,
  irem: 0x70,
  ineg: 0x74,
  ishl: 0x78,
  ishr: 0x7a,
  iushr: 0x7c,
  iand: 0x7e,
  ior: 0x80,
  ixor: 0x82,
  iinc: 0x84,
  i2b: 0x91,
  i2c: 0x92,
  i2s: 0x93,
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
  if_acmpeq: 0xa5,
  if_acmpne: 0xa6,
  goto: 0xa7,
  tableswitch: 0xaa,
  lookupswitch: 0xab,
  ireturn: 0xac,
  areturn: 0xb0,
  return: 0xb1,
  getstatic: 0xb2,
  getfield: 0xb4,
  putfield: 0xb5,
  invokevirtual: 0xb6,
  invokespecial: 0xb7,
  invokestatic: 0xb8,
  new: 0xbb,
  newarray: 0xbc,
  arraylength: 0xbe,
  athrow: 0xbf,
  ifnull: 0xc6,
  ifnonnull: 0xc7,
} as const;

type Op = (typeof Op)[keyof typeof Op];

/** Opcodes `execute()` can run; everything else ends the run with `unsupported-opcode`. */
export const EXECUTABLE_OPCODES: ReadonlySet<number> = new Set<number>(Object.values(Op));

function isExecutable(opcode: number): opcode is Op {
  return EXECUTABLE_OPCODES.has(opcode);
}

interface Machine extends MachineState {
  readonly classFile: ClassFile;
  readonly prepared: Map<MethodInfo, PreparedMethod>;
  readonly maxCallDepth: number;
  readonly callStack: Frame[];
  /** Shared by every frame of the run, and never unwound (JVMS §2.5.3). */
  readonly heap: Heap;
  /** What the program has printed, in the order it printed it. */
  readonly console: ConsoleOutput;
  /** Objects the machine names but does not model, by handle — see externals.ts. */
  readonly externals: ExternalPool;
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
    case Op.ldc:
    case Op.ldc_w:
      pushPoolConstant(machine, frame, operand(instruction, 0));
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
      pushReferenceLocal(frame, operand(instruction, 0));
      break;
    case Op.aload_0:
      pushReferenceLocal(frame, 0);
      break;
    case Op.aload_1:
      pushReferenceLocal(frame, 1);
      break;
    case Op.aload_2:
      pushReferenceLocal(frame, 2);
      break;
    case Op.aload_3:
      pushReferenceLocal(frame, 3);
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
      popIntoReferenceLocal(frame, operand(instruction, 0));
      break;
    case Op.astore_0:
      popIntoReferenceLocal(frame, 0);
      break;
    case Op.astore_1:
      popIntoReferenceLocal(frame, 1);
      break;
    case Op.astore_2:
      popIntoReferenceLocal(frame, 2);
      break;
    case Op.astore_3:
      popIntoReferenceLocal(frame, 3);
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

    // The operand stack instructions are type-agnostic (JVMS §6.5 dup): duplicating a
    // reference must not turn it into an int, so all of them move `StackValue`s.
    //
    // `pop2`, `dup2` and `dup2_x1` also have a form that moves a single category-2 value
    // (`long`/`double`) instead of two category-1 ones. No value in this machine is
    // category 2 — there are no `long` or `double` slots at all — so only the category-1
    // form can occur, and the category-2 form is deliberately not implemented rather than
    // half-implemented.
    case Op.pop:
      popAny(frame);
      break;
    case Op.pop2:
      popAny(frame);
      popAny(frame);
      break;
    case Op.dup:
      pushValues(frame, [peekAny(frame)]);
      break;
    case Op.dup_x1: {
      // `…, value2, value1 → …, value1, value2, value1`
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      pushValues(frame, [value1, value2, value1]);
      break;
    }
    case Op.dup2: {
      // `…, value2, value1 → …, value2, value1, value2, value1`
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      pushValues(frame, [value2, value1, value2, value1]);
      break;
    }
    case Op.dup2_x1: {
      // `…, value3, value2, value1 → …, value2, value1, value3, value2, value1`
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      const value3 = popAny(frame);
      pushValues(frame, [value2, value1, value3, value2, value1]);
      break;
    }
    case Op.swap: {
      // `…, value2, value1 → …, value1, value2`
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      pushValues(frame, [value1, value2]);
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
    case Op.ishl:
      binary(frame, ishl);
      break;
    case Op.ishr:
      binary(frame, ishr);
      break;
    case Op.iushr:
      binary(frame, iushr);
      break;
    case Op.iand:
      binary(frame, iand);
      break;
    case Op.ior:
      binary(frame, ior);
      break;
    case Op.ixor:
      binary(frame, ixor);
      break;

    case Op.i2b:
      push(frame, i2b(pop(frame, 'int')), 'int');
      break;
    case Op.i2c:
      push(frame, i2c(pop(frame, 'int')), 'int');
      break;
    case Op.i2s:
      push(frame, i2s(pop(frame, 'int')), 'int');
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
    // JVMS §6.5 if_acmp<cond>: two references are equal when they name the same object, which
    // for this machine is the same handle — `null` included, as -1.
    case Op.if_acmpeq:
    case Op.if_acmpne: {
      const value2 = popReference(frame);
      const value1 = popReference(frame);
      const same = value1.value === value2.value && value1.kind === value2.kind;
      branchIf(frame, instruction, opcode === Op.if_acmpeq ? same : !same);
      break;
    }
    case Op.ifnull:
      branchIf(frame, instruction, popReference(frame).value === NULL_REFERENCE);
      break;
    case Op.ifnonnull:
      branchIf(frame, instruction, popReference(frame).value !== NULL_REFERENCE);
      break;
    case Op.goto:
      setPc(frame, branchTargetOf(instruction));
      break;
    case Op.tableswitch:
    case Op.lookupswitch:
      setPc(frame, switchTargetOf(instruction, pop(frame, 'int')));
      break;

    case Op.getstatic:
      pushStaticField(machine, frame, operand(instruction, 0));
      break;
    case Op.new:
      allocateInstance(machine, frame, operand(instruction, 0));
      break;
    case Op.getfield:
      readField(machine, frame, operand(instruction, 0));
      break;
    case Op.putfield:
      writeField(machine, frame, operand(instruction, 0));
      break;
    case Op.invokespecial:
      invokeSpecial(machine, frame, operand(instruction, 0));
      break;
    case Op.invokevirtual:
      invokeVirtual(machine, frame, operand(instruction, 0));
      break;
    case Op.invokestatic:
      invokeStatic(machine, frame, operand(instruction, 0));
      break;
    case Op.athrow:
      throwFromStack(machine, frame);
      break;
    case Op.ireturn:
      returnFromFrame(machine, { value: pop(frame, 'int'), kind: 'int' });
      break;
    case Op.areturn:
      returnFromFrame(machine, popReference(frame));
      break;
    case Op.return:
      returnFromFrame(machine, undefined);
      break;

    default:
      opcode satisfies never;
      break;
  }
}

/** `iload`: the slot must already hold a value of the kind the instruction reads. */
function pushLocal(frame: Frame, slot: number, kind: ValueKind): void {
  push(frame, loadLocal(frame, slot, kind), kind);
}

/** `istore`: what the instruction takes off the stack is what the slot then holds. */
function popIntoLocal(frame: Frame, slot: number, kind: ValueKind): void {
  storeLocal(frame, slot, pop(frame, kind), kind);
}

/** `aload`/`astore` move whatever reference the slot holds, heap handle or external token. */
function pushReferenceLocal(frame: Frame, slot: number): void {
  const held = loadReference(frame, slot);
  push(frame, held.value, held.kind);
}

function popIntoReferenceLocal(frame: Frame, slot: number): void {
  const popped = popReference(frame);
  storeLocal(frame, slot, popped.value, popped.kind);
}

/** Pushes values bottom-first, so a list reads in the order JVMS §6.5 writes the result. */
function pushValues(frame: Frame, values: readonly StackValue[]): void {
  for (const value of values) {
    push(frame, value.value, value.kind);
  }
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

/**
 * JVMS §6.5 tableswitch/lookupswitch: the arm whose match is the popped key, and the default
 * branch when none is. `tableswitch` states the same rule as a range check on [low, high],
 * which is the range its arms cover, so one lookup answers both instructions.
 *
 * The decoder puts the default first, which is the only arm without a match value.
 */
function switchTargetOf(instruction: Instruction, key: number): number {
  const [fallback, ...arms] = instruction.switchTargets ?? [];
  if (fallback === undefined) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `${instruction.mnemonic} without a jump table`,
    });
  }
  return arms.find((arm) => arm.match === key)?.target ?? fallback.target;
}

/**
 * JVMS §6.5 athrow: `…, objectref → objectref`, and then the handler search takes over. The
 * object has to be one this machine already holds — which, since nothing here can construct an
 * exception, means one it threw earlier and a handler caught. Throwing a `String` constant is
 * a state the verifier rejects, and it is reported as one rather than unwound.
 */
function throwFromStack(machine: Machine, frame: Frame): void {
  const handle = pop(frame, 'external');
  const value = machine.externals.at(handle);
  if (value === undefined || !isThrowableClass(value.className)) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `athrow needs a throwable on the operand stack, found ${value?.label ?? 'an unknown object'}`,
    });
  }
  throw new VmFault({ kind: 'thrown', handle, className: value.className, label: value.label });
}

function returnFromFrame(machine: Machine, returned: StackValue | undefined): void {
  machine.callStack.pop();
  if (returned === undefined) {
    return;
  }
  const caller = machine.callStack.at(-1);
  if (caller === undefined) {
    // The result of the whole run, which the UI reports as a number; a reference leaving the
    // entry method is a handle into a heap the run is about to end with, and says nothing.
    machine.returnValue = returned.kind === 'int' ? returned.value : undefined;
    return;
  }
  push(caller, returned.value, returned.kind);
}

/**
 * JVMS §6.5 ldc/ldc_w: an `int` is pushed as itself; a `String` constant becomes a token, so
 * it can be passed to a recognised method without the machine having to build a String object
 * (JVMS §5.1 interns one object per pool entry, which `ExternalPool` reproduces).
 *
 * Everything else the pool can hold there — `float`, a class literal, a method handle — has no
 * representation in this machine and is reported as such rather than pushed as some number.
 */
function pushPoolConstant(machine: Machine, frame: Frame, poolIndex: number): void {
  const pool = machine.classFile.constantPool;
  const entry = poolEntry(pool, poolIndex);

  if (entry?.tag === ConstantTag.Integer) {
    push(frame, entry.value, 'int');
    return;
  }
  if (entry?.tag === ConstantTag.String) {
    push(
      frame,
      machine.externals.intern(stringConstant(utf8(pool, entry.stringIndex))),
      'external',
    );
    return;
  }
  throw new VmFault({ kind: 'unsupported-constant', target: describeConstant(entry, poolIndex) });
}

/** Tag names as JVMS §4.4 writes them, so an error can say `a Double constant`. */
const TAG_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(ConstantTag).map(([name, tag]) => [tag, name]),
);

function describeConstant(entry: ConstantPoolEntry | undefined, index: number): string {
  const named = entry === undefined ? undefined : TAG_NAMES.get(entry.tag);
  return named === undefined
    ? `constant pool entry #${String(index)}`
    : `the ${named} constant at #${String(index)}`;
}

/**
 * JVMS §6.5 getstatic. There is no class initialisation and no static state here, so the only
 * fields that resolve are the ones `externals.ts` lists — `System.out` and, one day, whatever
 * else earns a row. The value pushed is a token, not an object.
 */
function pushStaticField(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMemberReference(
    machine.classFile.constantPool,
    poolIndex,
    ConstantTag.Fieldref,
    'Fieldref',
  );
  const key = memberKey(reference.className, reference.name, reference.descriptor);
  const value = EXTERNAL_FIELDS.get(key);
  if (value === undefined) {
    throw new VmFault({ kind: 'unsupported-field', target: key });
  }
  push(frame, machine.externals.intern(value), 'external');
}

/** JVMS §4.1: every class this machine can build an instance of extends Object directly. */
const OBJECT_CLASS = 'java/lang/Object';

/**
 * JVMS §6.5 new: an uninitialised instance of the class the pool entry names.
 *
 * Only the class being executed can be instantiated, which is the boundary `invokestatic` has
 * always had and for the same reason: nothing here loads a second class file, so there is no
 * field table to give the object a shape.
 *
 * The instance appears on the stack before its constructor has run — that is the real order,
 * and it is worth seeing: `new` and `invokespecial` are two instructions, and between them
 * sits an object whose fields are all still at their defaults.
 */
function allocateInstance(machine: Machine, frame: Frame, poolIndex: number): void {
  const className = classNameAt(machine.classFile.constantPool, poolIndex);
  if (className !== machine.classFile.thisClassName) {
    throw new VmFault({ kind: 'unsupported-call', target: `new ${className}` });
  }
  const fields = machine.classFile.fields
    .filter((field) => !isStatic(field.accessFlags))
    .map((field) => ({ name: field.name, descriptor: field.descriptor }));
  push(frame, machine.heap.allocateInstance(className, fields), 'ref');
}

/** JVMS §6.5 getfield: `…, objectref → …, value`. */
function readField(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = fieldReference(machine, poolIndex);
  const held = machine.heap.loadField(pop(frame, 'ref'), reference.name);
  push(frame, held.value, held.kind);
}

/** JVMS §6.5 putfield: `…, objectref, value →`, so the value comes off first. */
function writeField(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = fieldReference(machine, poolIndex);
  const value = popAny(frame);
  machine.heap.storeField(pop(frame, 'ref'), reference.name, value.value, value.kind);
}

/** A Fieldref that names a field of the executed class; anything else has no object behind it. */
function fieldReference(machine: Machine, poolIndex: number): MethodReference {
  const reference = resolveMemberReference(
    machine.classFile.constantPool,
    poolIndex,
    ConstantTag.Fieldref,
    'Fieldref',
  );
  if (reference.className !== machine.classFile.thisClassName) {
    throw new VmFault({
      kind: 'unsupported-field',
      target: memberKey(reference.className, reference.name, reference.descriptor),
    });
  }
  return reference;
}

/**
 * JVMS §6.5 invokespecial, which in this subset means one thing: a constructor.
 *
 * Two shapes reach it. `super()` compiles to `Object.<init>()V` on every class here, and there
 * is no Object to initialise — the receiver is popped and the call is over. The class's own
 * `<init>` is an ordinary method call with the new object in slot 0.
 *
 * Private and super-class method calls also use this opcode; neither can occur while a class
 * can only see itself, so they are reported rather than guessed at.
 */
function invokeSpecial(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);

  if (reference.className === OBJECT_CLASS && reference.name === CONSTRUCTOR) {
    // `Object.<init>` sets up nothing this machine models; the receiver is all it consumes.
    pop(frame, 'ref');
    return;
  }
  if (reference.className !== machine.classFile.thisClassName) {
    throw new VmFault({ kind: 'unsupported-call', target: callTarget(reference) });
  }
  callWithin(machine, frame, reference, 'instance');
}

const CONSTRUCTOR = '<init>';

/**
 * JVMS §6.5 invokevirtual, restricted to the recognised members: the stack holds
 * `…, objectref, [arg1, …]`, so the arguments come off first and the receiver last.
 *
 * The receiver has to be a token of the class the reference names. Calling a listed method on
 * the wrong object — `PrintStream.println` on a `String` — is reported as the call it is,
 * rather than being answered with the output of the method that was not invoked.
 */
function invokeVirtual(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);

  // An instance method of the executed class is a frame like any other; only the receiver in
  // slot 0 makes it different from a static call.
  if (reference.className === machine.classFile.thisClassName) {
    callWithin(machine, frame, reference, 'instance');
    return;
  }

  const method = EXTERNAL_METHODS.get(
    memberKey(reference.className, reference.name, reference.descriptor),
  );
  if (method?.dispatch !== 'virtual') {
    throw new VmFault({ kind: 'unsupported-call', target: callTarget(reference) });
  }

  const args = popArguments(machine, frame, method.parameters);
  const receiver = machine.externals.at(pop(frame, 'external'));
  if (receiver?.className !== reference.className) {
    throw new VmFault({
      kind: 'unsupported-call',
      target: `${callTarget(reference)} on ${receiver?.label ?? 'an unknown object'}`,
    });
  }
  applyExternal(machine, frame, method, receiver, args);
}

/**
 * A call the machine answers itself rather than by pushing a frame. The result — an int or
 * nothing — goes straight back on the caller's stack, so from the bytecode's point of view
 * the call has simply returned.
 */
function applyExternal(
  machine: Machine,
  frame: Frame,
  method: ExternalMethod,
  receiver: ExternalValue | undefined,
  args: readonly ExternalArgument[],
): void {
  const result = method.apply({ receiver, args, console: machine.console });
  if (result !== undefined) {
    push(frame, result, 'int');
  }
}

/** Arguments were pushed left to right, so they come off the stack in reverse order. */
function popArguments(
  machine: Machine,
  frame: Frame,
  parameters: readonly ValueKind[],
): readonly ExternalArgument[] {
  const args = new Array<ExternalArgument>(parameters.length);
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    const kind = parameters[index];
    if (kind === 'external') {
      const value = machine.externals.at(pop(frame, 'external'));
      if (value === undefined) {
        throw new VmFault({ kind: 'invalid-state', message: 'argument names no known object' });
      }
      args[index] = { kind: 'external', value };
    } else {
      args[index] = { kind: 'int', value: pop(frame, 'int') };
    }
  }
  return args;
}

function invokeStatic(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);
  const target = callTarget(reference);
  if (reference.className !== machine.classFile.thisClassName) {
    // Outside the executed class, only the members `externals.ts` lists resolve — the class
    // file names them but nothing here can load them.
    const method = EXTERNAL_METHODS.get(
      memberKey(reference.className, reference.name, reference.descriptor),
    );
    if (method?.dispatch !== 'static') {
      throw new VmFault({ kind: 'unsupported-call', target });
    }
    applyExternal(
      machine,
      frame,
      method,
      undefined,
      popArguments(machine, frame, method.parameters),
    );
    return;
  }

  callWithin(machine, frame, reference, 'static');
}

/**
 * A call to a method of the class being executed: the one kind this machine resolves itself.
 *
 * `shape` decides two things at once — whether the method must be static, and whether a
 * receiver is popped after the arguments and laid into slot 0 (JVMS §2.6.1). Everything else,
 * including the depth limit, is the same for both, which is why they share this.
 */
function callWithin(
  machine: Machine,
  frame: Frame,
  reference: MethodReference,
  shape: 'static' | 'instance',
): void {
  const target = callTarget(reference);
  const parameters = parameterKinds(reference.descriptor);
  const method = findMethod(machine.classFile, reference.name, reference.descriptor);
  const code = method?.code;
  if (
    parameters === undefined ||
    method === undefined ||
    code === undefined ||
    isStatic(method.accessFlags) !== (shape === 'static')
  ) {
    throw new VmFault({ kind: 'unsupported-call', target });
  }
  // Recursion without a base case would otherwise grow the history until the tab dies; a real
  // JVM answers the same situation with StackOverflowError (JVMS §2.6.2).
  if (machine.callStack.length >= machine.maxCallDepth) {
    throw new VmFault({ kind: 'stack-overflow', limit: machine.maxCallDepth });
  }

  // Arguments were pushed left to right, so they come off the stack in reverse order; the
  // receiver was pushed before all of them, so it comes off last and sits in front of them.
  const slots = new Array<StackValue>(parameters.length);
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    const kind = parameters[index];
    slots[index] = kind === 'int' ? { value: pop(frame, 'int'), kind: 'int' } : popReference(frame);
  }
  if (shape === 'instance') {
    slots.unshift(popReference(frame));
  }

  machine.callStack.push(createFrame(prepare(machine.prepared, method, code), slots));
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

/**
 * The kind each parameter arrives as, or `undefined` for a descriptor this machine cannot
 * call: anything with a `long`, `float` or `double` in it, which needs slots it has no model
 * for. An `int` is a value and everything else in the subset is a reference.
 */
function parameterKinds(descriptor: string): readonly ValueKind[] | undefined {
  const parsed = parseDescriptor(descriptor);
  if (parsed === undefined) {
    return undefined;
  }
  const returnable =
    parsed.returnType.kind === 'void' ||
    isIntType(parsed.returnType) ||
    isReferenceType(parsed.returnType);
  if (!returnable || !parsed.params.every((type) => isIntType(type) || isReferenceType(type))) {
    return undefined;
  }
  return parsed.params.map((type) => (isIntType(type) ? 'int' : 'ref'));
}

/** A class or an array type — the two shapes a reference can have (JVMS §4.3.2). */
function isReferenceType(type: JvmReturnType): boolean {
  return type.kind === 'class' || type.kind === 'array';
}

/** The class a `new` or a `catch` names, resolved through its Class entry. */
function classNameAt(pool: ConstantPool, index: number): string {
  const entry = poolEntry(pool, index);
  if (entry?.tag !== ConstantTag.Class) {
    throw badPoolEntry(index, 'Class');
  }
  return utf8(pool, entry.nameIndex);
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

/** How a call is named in an error: `Factorial.factorial(I)I`, as the UI has always shown it. */
function callTarget(reference: MethodReference): string {
  return `${reference.className}.${reference.name}${reference.descriptor}`;
}

function resolveMethodref(pool: ConstantPool, index: number): MethodReference {
  return resolveMemberReference(pool, index, ConstantTag.Methodref, 'Methodref');
}

/**
 * JVMS §4.4.2: a Methodref and a Fieldref have the same shape — Class + NameAndType, all of
 * them Utf8 in the end — and differ only in their tag.
 */
function resolveMemberReference(
  pool: ConstantPool,
  index: number,
  tag: typeof ConstantTag.Methodref | typeof ConstantTag.Fieldref,
  tagName: string,
): MethodReference {
  const reference = poolEntry(pool, index);
  if (reference?.tag !== tag) {
    throw badPoolEntry(index, tagName);
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
