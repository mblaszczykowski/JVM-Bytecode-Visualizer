import type { Instruction } from '../disassembler';
import type { Frame } from './frame';
import type { Snapshot, StackFrame } from './types';

/**
 * Turns the mutable machine state into the frozen shapes the player replays.
 *
 * Every snapshot is a deep copy: the interpreter keeps mutating the same frames, so sharing
 * the arrays would make the whole history collapse onto the final state. Freezing costs
 * little at MVP sizes (a few thousand steps over frames of a handful of slots) and makes
 * the immutability guarantee real rather than type-level only.
 */
export function createSnapshot(
  step: number,
  callStack: readonly Frame[],
  currentInstruction: Instruction,
  sourceLine: number | undefined,
): Snapshot {
  return Object.freeze({
    step,
    callStack: Object.freeze(callStack.map(toStackFrame)),
    currentInstruction: freezeInstruction(currentInstruction),
    ...(sourceLine === undefined ? {} : { sourceLine }),
  });
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
    // Names never change during a run, so the array is shared (and already frozen).
    localNames: frame.method.localNames,
  });
}

function freezeInstruction(instruction: Instruction): Instruction {
  Object.freeze(instruction.operands);
  return Object.freeze(instruction);
}
