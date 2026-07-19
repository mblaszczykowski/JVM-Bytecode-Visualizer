import type { Instruction } from '../disassembler';
import { localNamesAt, type Frame } from './frame';
import type { Snapshot, StackFrame } from './types';

/**
 * Turns the mutable machine state into the frozen shapes the player replays.
 *
 * A frame has to be copied: the interpreter keeps mutating the same objects, so sharing them
 * would collapse the whole history onto the final state. Copying the *entire* call stack on
 * every step, however, costs O(steps × depth) — a thousand nested calls alone allocated
 * gigabytes. Between two consecutive instructions only the top of the stack moves, so the
 * frozen copies of the frames below it are carried over and every frame is copied once per
 * change rather than once per step.
 *
 * One writer per run: the reuse is only sound for the frames of the machine it was made for.
 */
export class SnapshotWriter {
  /** Last copy emitted per call stack depth, with the frame version it was taken from. */
  private readonly emitted: (EmittedFrame | undefined)[] = [];

  next(
    step: number,
    callStack: readonly Frame[],
    currentInstruction: Instruction,
    sourceLine: number | undefined,
  ): Snapshot {
    const frames = callStack.map((frame, depth) => this.copyOrReuse(depth, frame));
    // Frames of returned calls are gone for good; dropping them releases the popped Frames.
    this.emitted.length = callStack.length;

    return Object.freeze({
      step,
      callStack: Object.freeze(frames),
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

/** Closing state after the entry frame returns: nothing left to execute. */
export function createTerminalSnapshot(step: number): Snapshot {
  return Object.freeze({ step, callStack: Object.freeze([]) });
}

/** JVMS §4.7.12: the current line is the entry with the largest `startPc <= pc`. */
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
    // Which variable a slot holds depends on the pc; the arrays are frozen and shared.
    localNames: localNamesAt(frame.method, frame.pc),
  });
}

function freezeInstruction(instruction: Instruction): Instruction {
  Object.freeze(instruction.operands);
  return Object.freeze(instruction);
}
