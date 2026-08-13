import {
  ConstantTag,
  isStatic,
  type ClassFile,
  type CodeAttribute,
  type ExceptionTableEntry,
  type MethodInfo,
} from '../classfile';
import { arrayTypeName, lookupOpcode, T_INT, type Instruction } from '../disassembler';
import { RecordingBudget } from './budget';
import { ConsoleOutput } from './console';
import { isVmFault, thrownBy, toVmError, VmFault } from './errors';
import {
  EXTERNAL_FIELDS,
  EXTERNAL_METHODS,
  ExternalPool,
  memberKey,
  stringConstant,
  throwableObject,
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
  type RunClock,
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
  callTarget,
  classNameAt,
  describeConstant,
  parameterKinds,
  poolEntry,
  resolveMemberReference,
  resolveMethodref,
  utf8,
  type MethodReference,
} from './pool';
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
  type VmFaultDetail,
} from './types';

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

  const clock: RunClock = { step: 0 };
  let entryFrame: Frame;
  try {
    entryFrame = createFrame(prepare(prepared, entry.method, entry.code), [], clock);
  } catch (error) {
    return failedRun(error, snapshots, 0, entry.method.name);
  }

  const budget = new RecordingBudget();
  const machine: Machine = {
    classFile,
    prepared,
    calls: new Map(),
    instanceFields: undefined,
    maxCallDepth: atLeastOne(options.maxCallDepth, DEFAULT_MAX_CALL_DEPTH),
    callStack: [entryFrame],
    clock,
    heap: new Heap(budget),
    console: new ConsoleOutput(budget),
    externals: new ExternalPool(budget),
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
      frame.currentPc = offset;
      clock.step = snapshots.length - 1;
      setPc(frame, fetched.nextOffset);
      step(machine, frame, fetched.instruction);
    } catch (error) {
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

function dispatchThrow(machine: Machine, detail: VmFaultDetail): boolean {
  const thrown = thrownBy(detail);
  if (thrown === undefined) {
    return false;
  }

  for (
    let frame = machine.callStack.at(-1);
    frame !== undefined;
    frame = machine.callStack.at(-1)
  ) {
    const handler = handlerFor(frame, thrown.className);
    if (handler !== undefined) {
      const handle =
        thrown.handle ?? machine.externals.add(throwableObject(thrown.className, thrown.message));
      clearOperandStack(frame);
      push(frame, handle, 'external');
      setPc(frame, handler.handlerPc);
      return true;
    }
    machine.callStack.pop();
  }
  return false;
}

function handlerFor(frame: Frame, thrownClass: string): ExceptionTableEntry | undefined {
  return frame.method.code.exceptionTable?.find(
    (entry) =>
      frame.currentPc >= entry.startPc &&
      frame.currentPc < entry.endPc &&
      catches(entry.catchType, thrownClass),
  );
}

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

function atLeastOne(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

const ENTRY_DESCRIPTORS: ReadonlySet<string> = new Set(['([Ljava/lang/String;)V', '()V', '()I']);

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
  dup_x2: 0x5b,
  dup2: 0x5c,
  dup2_x1: 0x5d,
  dup2_x2: 0x5e,
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

export const EXECUTABLE_OPCODES: ReadonlySet<number> = new Set<number>(Object.values(Op));

function isExecutable(opcode: number): opcode is Op {
  return EXECUTABLE_OPCODES.has(opcode);
}

interface Machine extends MachineState {
  readonly classFile: ClassFile;
  readonly prepared: Map<MethodInfo, PreparedMethod>;
  readonly calls: Map<number, ResolvedCall>;
  instanceFields: readonly InstanceField[] | undefined;
  readonly maxCallDepth: number;
  readonly callStack: Frame[];
  readonly clock: RunClock;
  readonly heap: Heap;
  readonly console: ConsoleOutput;
  readonly externals: ExternalPool;
  returnValue: number | undefined;
}

interface ResolvedCall {
  readonly method: MethodInfo;
  readonly code: CodeAttribute;
  readonly parameters: readonly ValueKind[];
  readonly isStatic: boolean;
}

interface InstanceField {
  readonly name: string;
  readonly descriptor: string;
}

function fetchAt(frame: Frame): { readonly instruction: Instruction; readonly nextOffset: number } {
  const fetched = frame.method.flow.get(frame.pc);
  if (fetched === undefined) {
    throw undecodable(frame);
  }
  return fetched;
}

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
      const index = pop(frame, 'int');
      const arrayref = pop(frame, 'ref');
      push(frame, machine.heap.loadInt(arrayref, index), 'int');
      break;
    }
    case Op.iastore: {
      const value = pop(frame, 'int');
      const index = pop(frame, 'int');
      const arrayref = pop(frame, 'ref');
      machine.heap.storeInt(arrayref, index, value);
      break;
    }

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
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      pushValues(frame, [value1, value2, value1]);
      break;
    }
    case Op.dup_x2: {
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      const value3 = popAny(frame);
      pushValues(frame, [value1, value3, value2, value1]);
      break;
    }
    case Op.dup2: {
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      pushValues(frame, [value2, value1, value2, value1]);
      break;
    }
    case Op.dup2_x1: {
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      const value3 = popAny(frame);
      pushValues(frame, [value2, value1, value3, value2, value1]);
      break;
    }
    case Op.dup2_x2: {
      const value1 = popAny(frame);
      const value2 = popAny(frame);
      const value3 = popAny(frame);
      const value4 = popAny(frame);
      pushValues(frame, [value2, value1, value4, value3, value2, value1]);
      break;
    }
    case Op.swap: {
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

function pushLocal(frame: Frame, slot: number, kind: ValueKind): void {
  push(frame, loadLocal(frame, slot, kind), kind);
}

function popIntoLocal(frame: Frame, slot: number, kind: ValueKind): void {
  storeLocal(frame, slot, pop(frame, kind), kind);
}

function pushReferenceLocal(frame: Frame, slot: number): void {
  const held = loadReference(frame, slot);
  push(frame, held.value, held.kind);
}

function popIntoReferenceLocal(frame: Frame, slot: number): void {
  const popped = popReference(frame);
  storeLocal(frame, slot, popped.value, popped.kind);
}

function pushValues(frame: Frame, values: readonly StackValue[]): void {
  for (const value of values) {
    push(frame, value.value, value.kind);
  }
}

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

function throwFromStack(machine: Machine, frame: Frame): void {
  const objectref = popReference(frame);
  if (objectref.value === NULL_REFERENCE) {
    throw new VmFault({ kind: 'null-reference' });
  }
  const value = externalAt(machine, objectref);
  if (value === undefined || !isThrowableClass(value.className)) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `athrow needs a throwable on the operand stack, found ${value?.label ?? 'an unknown object'}`,
    });
  }
  throw new VmFault({
    kind: 'thrown',
    handle: objectref.value,
    className: value.className,
    label: value.detail ?? value.label,
  });
}

function externalAt(machine: Machine, reference: StackValue): ExternalValue | undefined {
  return reference.kind === 'external' ? machine.externals.at(reference.value) : undefined;
}

function returnFromFrame(machine: Machine, returned: StackValue | undefined): void {
  machine.callStack.pop();
  if (returned === undefined) {
    return;
  }
  const caller = machine.callStack.at(-1);
  if (caller === undefined) {
    machine.returnValue = returned.kind === 'int' ? returned.value : undefined;
    return;
  }
  push(caller, returned.value, returned.kind);
}

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

const OBJECT_CLASS = 'java/lang/Object';

function allocateInstance(machine: Machine, frame: Frame, poolIndex: number): void {
  const className = classNameAt(machine.classFile.constantPool, poolIndex);
  if (className !== machine.classFile.thisClassName) {
    throw new VmFault({ kind: 'unsupported-call', target: `new ${className}` });
  }
  machine.instanceFields ??= machine.classFile.fields
    .filter((field) => !isStatic(field.accessFlags))
    .map((field) => ({ name: field.name, descriptor: field.descriptor }));
  push(frame, machine.heap.allocateInstance(className, machine.instanceFields), 'ref');
}

function readField(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = fieldReference(machine, poolIndex);
  const held = machine.heap.loadField(pop(frame, 'ref'), reference.name);
  push(frame, held.value, held.kind);
}

function writeField(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = fieldReference(machine, poolIndex);
  const value = popAny(frame);
  machine.heap.storeField(pop(frame, 'ref'), reference.name, value.value, value.kind);
}

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

function invokeSpecial(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);

  if (reference.className === OBJECT_CLASS && reference.name === CONSTRUCTOR) {
    pop(frame, 'ref');
    return;
  }
  if (reference.className !== machine.classFile.thisClassName) {
    throw new VmFault({ kind: 'unsupported-call', target: callTarget(reference) });
  }
  callWithin(machine, frame, poolIndex, reference, 'instance');
}

const CONSTRUCTOR = '<init>';

function invokeVirtual(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);

  if (reference.className === machine.classFile.thisClassName) {
    callWithin(machine, frame, poolIndex, reference, 'instance');
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

function popArguments(
  machine: Machine,
  frame: Frame,
  parameters: readonly ValueKind[],
): readonly ExternalArgument[] {
  const args = new Array<ExternalArgument>(parameters.length);
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    args[index] =
      parameters[index] === 'external'
        ? popExternalArgument(machine, frame)
        : { kind: 'int', value: pop(frame, 'int') };
  }
  return args;
}

function popExternalArgument(machine: Machine, frame: Frame): ExternalArgument {
  const reference = popReference(frame);
  if (reference.value === NULL_REFERENCE) {
    return { kind: 'null' };
  }
  const value = externalAt(machine, reference);
  if (value === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'argument names no known object' });
  }
  return { kind: 'external', value };
}

function invokeStatic(machine: Machine, frame: Frame, poolIndex: number): void {
  const reference = resolveMethodref(machine.classFile.constantPool, poolIndex);
  if (reference.className !== machine.classFile.thisClassName) {
    const method = EXTERNAL_METHODS.get(
      memberKey(reference.className, reference.name, reference.descriptor),
    );
    if (method?.dispatch !== 'static') {
      throw new VmFault({ kind: 'unsupported-call', target: callTarget(reference) });
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

  callWithin(machine, frame, poolIndex, reference, 'static');
}

function callWithin(
  machine: Machine,
  frame: Frame,
  poolIndex: number,
  reference: MethodReference,
  shape: 'static' | 'instance',
): void {
  const call = resolveCall(machine, poolIndex, reference, shape);
  if (call === undefined) {
    throw new VmFault({ kind: 'unsupported-call', target: callTarget(reference) });
  }
  if (machine.callStack.length >= machine.maxCallDepth) {
    throw new VmFault({ kind: 'stack-overflow', limit: machine.maxCallDepth });
  }

  const { parameters } = call;
  const receiverSlots = shape === 'instance' ? 1 : 0;
  const slots = new Array<StackValue>(parameters.length + receiverSlots);
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    slots[index + receiverSlots] =
      parameters[index] === 'int' ? { value: pop(frame, 'int'), kind: 'int' } : popReference(frame);
  }
  if (shape === 'instance') {
    const receiver = popReference(frame);
    if (receiver.value === NULL_REFERENCE) {
      throw new VmFault({ kind: 'null-reference' });
    }
    slots[0] = receiver;
  }

  machine.callStack.push(
    createFrame(prepare(machine.prepared, call.method, call.code), slots, machine.clock),
  );
}

function resolveCall(
  machine: Machine,
  poolIndex: number,
  reference: MethodReference,
  shape: 'static' | 'instance',
): ResolvedCall | undefined {
  const call = machine.calls.get(poolIndex) ?? cacheCall(machine, poolIndex, reference);
  return call?.isStatic === (shape === 'static') ? call : undefined;
}

function cacheCall(
  machine: Machine,
  poolIndex: number,
  reference: MethodReference,
): ResolvedCall | undefined {
  const found = executableMethod(machine.classFile, reference.name, reference.descriptor);
  if (found === undefined) {
    return undefined;
  }

  const resolved: ResolvedCall = { ...found, isStatic: isStatic(found.method.accessFlags) };
  machine.calls.set(poolIndex, resolved);
  return resolved;
}

function executableMethod(
  classFile: ClassFile,
  name: string,
  descriptor: string,
): Omit<ResolvedCall, 'isStatic'> | undefined {
  const method = findMethod(classFile, name, descriptor);
  const code = method?.code;
  const parameters = parameterKinds(descriptor);
  if (method === undefined || code === undefined || parameters === undefined) {
    return undefined;
  }
  return { method, code, parameters };
}

export function opensFrame(
  classFile: ClassFile,
  owner: string,
  name: string,
  descriptor: string,
): boolean {
  return (
    owner === classFile.thisClassName && executableMethod(classFile, name, descriptor) !== undefined
  );
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

export function isEntryMethod(method: MethodInfo): boolean {
  return (
    method.code !== undefined &&
    isStatic(method.accessFlags) &&
    ENTRY_DESCRIPTORS.has(method.descriptor)
  );
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
