import type { Instruction } from '../disassembler';
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

export class SnapshotWriter {
  private readonly emitted: (EmittedFrame | undefined)[] = [];

  next(
    step: number,
    callStack: readonly Frame[],
    state: MachineState,
    currentInstruction: Instruction,
    sourceLine: number | undefined,
  ): Snapshot {
    const frames = callStack.map((frame, depth) => this.copyOrReuse(depth, frame));
    this.emitted.length = callStack.length;

    return Object.freeze({
      step,
      callStack: Object.freeze(frames),
      ...machineView(state),
      currentInstruction: freezeInstruction(currentInstruction),
      ...(sourceLine === undefined ? {} : { sourceLine }),
    });
  }

  private copyOrReuse(depth: number, frame: Frame): StackFrame {
    const previous = this.emitted[depth];
    if (previous?.source === frame && previous.version === frame.version) {
      return previous.stackFrame;
    }

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

export function sourceLineAt(frame: Frame): number | undefined {
  let line: number | undefined;
  let bestStartPc = -1;
  for (const entry of frame.method.lineNumbers) {
    if (entry.startPc <= frame.pc && entry.startPc > bestStartPc) {
      bestStartPc = entry.startPc;
      line = entry.lineNumber;
    }
  }
  return line;
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

function freezeInstruction(instruction: Instruction): Instruction {
  Object.freeze(instruction.operands);
  return Object.freeze(instruction);
}
