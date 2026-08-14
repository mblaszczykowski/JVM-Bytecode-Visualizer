import type { Instruction } from '../disassembler';
import type { RecordingBudget } from './budget';
import type { ConsoleOutput } from './console';
import type { ExternalPool } from './externals';
import { localNamesAt, type Frame } from './frame';
import type { Heap } from './heap';
import type { Snapshot, StackFrame } from './types';

export interface MachineState {
  readonly heap: Heap;
  readonly console: ConsoleOutput;
  readonly externals: ExternalPool;
}

const RECORDED_ARRAYS_PER_SLOT = 3;

export class SnapshotWriter {
  private readonly budget: RecordingBudget;
  private readonly emitted: (EmittedFrame | undefined)[] = [];

  constructor(budget: RecordingBudget) {
    this.budget = budget;
  }

  next(
    step: number,
    callStack: readonly Frame[],
    state: MachineState,
    currentInstruction: Instruction,
    sourceLine: number | undefined,
  ): Snapshot {
    this.budget.charge(callStack.length);
    const frames = callStack.map((frame, depth) => this.copyOrReuse(depth, frame));
    this.emitted.length = callStack.length;

    return Object.freeze({
      step,
      callStack: Object.freeze(frames),
      ...machineView(state),
      currentInstruction,
      ...(sourceLine === undefined ? {} : { sourceLine }),
    });
  }

  private copyOrReuse(depth: number, frame: Frame): StackFrame {
    const previous = this.emitted[depth];
    if (previous?.source === frame && previous.version === frame.version) {
      return previous.stackFrame;
    }
    this.budget.charge(
      RECORDED_ARRAYS_PER_SLOT * (frame.locals.length + frame.operandStack.length),
    );

    const stackFrame = toStackFrame(frame);
    this.emitted[depth] = { source: frame, version: frame.version, stackFrame };
    return stackFrame;
  }
}

interface EmittedFrame {
  readonly source: Frame;
  readonly version: number;
  readonly stackFrame: StackFrame;
}

export function createTerminalSnapshot(step: number, state: MachineState): Snapshot {
  return Object.freeze({ step, callStack: Object.freeze([]), ...machineView(state) });
}

function machineView(state: MachineState) {
  return {
    heap: state.heap.freeze(),
    consoleOutput: state.console.freeze(),
    externals: state.externals.freeze(),
  };
}

function toStackFrame(frame: Frame): StackFrame {
  return Object.freeze({
    methodName: frame.method.name,
    methodDescriptor: frame.method.descriptor,
    pc: frame.pc,
    operandStack: Object.freeze([...frame.operandStack]),
    locals: Object.freeze([...frame.locals]),
    localNames: localNamesAt(frame.method, frame.pc),
    operandKinds: Object.freeze([...frame.operandKinds]),
    localKinds: Object.freeze([...frame.localKinds]),
    operandOrigins: Object.freeze([...frame.operandOrigins]),
    localOrigins: Object.freeze([...frame.localOrigins]),
  });
}
