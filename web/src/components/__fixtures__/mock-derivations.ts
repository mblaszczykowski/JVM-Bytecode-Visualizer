/**
 * Values the presentational panels need but the `Snapshot` contract does not carry: stack
 * effects, plain-language explanations, operand roles and line-mapping metadata.
 *
 * They are derived from small tables here rather than written out per step, so the mock
 * stays honest — the same shape of derivation moves into the domain layer once the real
 * disassembler and interpreter are wired in.
 */

import type { Instruction } from '../../core/disassembler/types';
import type { Snapshot, StackFrame } from '../../core/interpreter/types';
import { hasConstantPoolOperand } from '../bytecode-format';
import type { NextInstructionCardProps } from '../NextInstructionCard';

import {
  findMockMethod,
  mockConstantPool,
  mockHistory,
  mockMainMethod,
  type MockMethod,
} from './mock-history';

interface StackEffect {
  /** Operand stack slots consumed. */
  readonly pops: number;
  /** Operand stack slots produced (a returning call counts as one for the caller). */
  readonly pushes: number;
  readonly labels: readonly string[];
}

const NO_EFFECT: StackEffect = { pops: 0, pushes: 0, labels: [] };

const COMPARISON: Readonly<Record<string, string>> = {
  if_icmpeq: '=',
  if_icmpne: '≠',
  if_icmplt: '<',
  if_icmpge: '≥',
  if_icmpgt: '>',
  if_icmple: '≤',
  ifeq: '=',
  ifne: '≠',
  iflt: '<',
  ifge: '≥',
  ifgt: '>',
  ifle: '≤',
};

/** Parameter count of a method descriptor. Supported descriptors only take `int` parameters. */
function arityOf(descriptor: string): number {
  const closing = descriptor.indexOf(')');
  return closing < 0 ? 0 : descriptor.slice(1, closing).length;
}

function returnsValue(descriptor: string): boolean {
  return !descriptor.endsWith(')V');
}

/** Local variable slot addressed by a load/store, either from the mnemonic suffix or the operand. */
function slotOf(instruction: Instruction): number {
  const suffix = instruction.mnemonic.split('_')[1];
  if (suffix !== undefined && /^\d+$/.test(suffix)) {
    return Number(suffix);
  }
  return instruction.operands[0] ?? 0;
}

function constantOf(instruction: Instruction): number {
  const suffix = instruction.mnemonic.split('_')[1];
  if (suffix === 'm1') {
    return -1;
  }
  if (suffix !== undefined && /^\d+$/.test(suffix)) {
    return Number(suffix);
  }
  return instruction.operands[0] ?? 0;
}

function calleeOf(instruction: Instruction): { name: string; descriptor: string } | undefined {
  const index = instruction.operands[0];
  const constant = index === undefined ? undefined : mockConstantPool.get(index);
  return constant === undefined
    ? undefined
    : { name: constant.methodName, descriptor: constant.methodDescriptor };
}

/** Stack effect of one instruction, by opcode family rather than by a per-instruction table. */
export function stackEffectOf(instruction: Instruction): StackEffect {
  const { mnemonic } = instruction;

  if (/^(iconst|bipush|sipush|iload)/.test(mnemonic)) {
    return { pops: 0, pushes: 1, labels: ['push int'] };
  }
  if (mnemonic.startsWith('istore')) {
    return { pops: 1, pushes: 0, labels: ['pop 1'] };
  }
  if (/^(iadd|isub|imul|idiv|irem)$/.test(mnemonic)) {
    return { pops: 2, pushes: 1, labels: ['pop 2', 'push int'] };
  }
  if (mnemonic === 'ineg' || mnemonic === 'pop') {
    return mnemonic === 'pop'
      ? { pops: 1, pushes: 0, labels: ['pop 1'] }
      : { pops: 1, pushes: 1, labels: ['pop 1', 'push int'] };
  }
  if (mnemonic === 'dup') {
    return { pops: 0, pushes: 1, labels: ['push int'] };
  }
  if (mnemonic.startsWith('if_icmp')) {
    return { pops: 2, pushes: 0, labels: ['pop 2'] };
  }
  if (mnemonic.startsWith('if')) {
    return { pops: 1, pushes: 0, labels: ['pop 1'] };
  }
  if (mnemonic === 'invokestatic') {
    const callee = calleeOf(instruction);
    const pops = callee === undefined ? 0 : arityOf(callee.descriptor);
    const pushes = callee !== undefined && returnsValue(callee.descriptor) ? 1 : 0;
    return {
      pops,
      pushes,
      labels: pops > 0 ? [`pop ${String(pops)}`, 'push frame'] : ['push frame'],
    };
  }
  if (mnemonic === 'ireturn') {
    return { pops: 1, pushes: 0, labels: ['pop 1', 'pop frame', 'push int'] };
  }
  if (mnemonic === 'return') {
    return { pops: 0, pushes: 0, labels: ['pop frame'] };
  }
  return NO_EFFECT;
}

export function methodOf(frame: StackFrame): MockMethod {
  return findMockMethod(frame.methodName, frame.methodDescriptor) ?? mockMainMethod;
}

function explain(instruction: Instruction, frame: StackFrame): string {
  const stack = frame.operandStack;
  const top = stack.at(-1);
  const below = stack.at(-2);
  const { mnemonic } = instruction;

  if (mnemonic.startsWith('iload')) {
    const slot = slotOf(instruction);
    const name = frame.localNames[slot] ?? `slot ${String(slot)}`;
    const value = frame.locals[slot];
    const shown = value === undefined ? 'an uninitialised slot' : String(value);
    return `Pushes local ${String(slot)} (${name} = ${shown}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('iconst') || mnemonic === 'bipush' || mnemonic === 'sipush') {
    return `Pushes the constant ${String(constantOf(instruction))} onto the operand stack.`;
  }

  if (mnemonic.startsWith('istore')) {
    const slot = slotOf(instruction);
    const name = frame.localNames[slot] ?? `slot ${String(slot)}`;
    return `Pops ${String(top ?? 0)} into local slot ${String(slot)} (${name}).`;
  }

  if (mnemonic.startsWith('if') && below !== undefined && top !== undefined) {
    const operator = COMPARISON[mnemonic] ?? '?';
    const target = instruction.branchTarget;
    const right = mnemonic.startsWith('if_icmp') ? String(top) : '0';
    const left = mnemonic.startsWith('if_icmp') ? String(below) : String(top);
    return `Pops both values and jumps to pc ${String(target ?? 0)} when ${left} ${operator} ${right}; otherwise falls through.`;
  }

  if (below !== undefined && top !== undefined) {
    switch (mnemonic) {
      case 'iadd':
        return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} + ${String(top)} = ${String(below + top)}.`;
      case 'isub':
        return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} − ${String(top)} = ${String(below - top)}.`;
      case 'imul':
        return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} × ${String(top)} = ${String(Math.imul(below, top))}.`;
      default:
        break;
    }
  }

  if (mnemonic === 'invokestatic') {
    const callee = calleeOf(instruction);
    if (callee !== undefined && top !== undefined) {
      return `Pops ${String(top)} off the stack and opens a frame for ${callee.name}${callee.descriptor} with that value in slot 0.`;
    }
  }

  if (mnemonic === 'ireturn' && top !== undefined) {
    return `Pops ${String(top)}, discards the frame of ${frame.methodName} and pushes the value onto the caller's stack.`;
  }

  if (mnemonic === 'return') {
    return `Discards the frame of ${frame.methodName} and returns nothing.`;
  }

  return `Executes ${mnemonic}.`;
}

/** Props for the "Next" card, or `undefined` for the terminal snapshot. */
export function describeNextInstruction(snapshot: Snapshot): NextInstructionCardProps | undefined {
  const frame = snapshot.callStack.at(-1);
  const instruction = snapshot.currentInstruction;
  if (frame === undefined || instruction === undefined) {
    return undefined;
  }

  const poolIndex = instruction.operands[0];
  const constant =
    hasConstantPoolOperand(instruction) && poolIndex !== undefined
      ? mockConstantPool.get(poolIndex)
      : undefined;

  return {
    effects: stackEffectOf(instruction).labels.map((label) => ({ label })),
    explanation: explain(instruction, frame),
    cpChain: constant?.chain,
  };
}

/**
 * Walks the method forward from the current instruction, tracking the operand stack height,
 * and reports which instruction eventually consumes the value at `targetIndex`. Straight-line
 * only — good enough to label a value as "waiting for imul" while a call runs.
 */
function consumerOf(method: MockMethod, fromOffset: number, height: number, targetIndex: number) {
  const start = method.instructions.findIndex((entry) => entry.offset === fromOffset);
  if (start < 0) {
    return undefined;
  }

  let stackHeight = height;
  for (let index = start; index < method.instructions.length; index++) {
    const instruction = method.instructions[index];
    if (instruction === undefined) {
      break;
    }
    const effect = stackEffectOf(instruction);
    if (stackHeight - effect.pops <= targetIndex) {
      return instruction.mnemonic;
    }
    stackHeight = stackHeight - effect.pops + effect.pushes;
  }
  return undefined;
}

/**
 * Role annotation per operand stack cell (indexed like `StackFrame.operandStack`): what the
 * current instruction is about to do with it, or which later instruction is waiting for it.
 */
export function describeOperandRoles(snapshot: Snapshot): readonly (string | undefined)[] {
  const frame = snapshot.callStack.at(-1);
  const instruction = snapshot.currentInstruction;
  if (frame === undefined || instruction === undefined) {
    return [];
  }

  const roles: (string | undefined)[] = frame.operandStack.map(() => undefined);
  const topIndex = frame.operandStack.length - 1;
  const effect = stackEffectOf(instruction);
  const isCall = instruction.mnemonic === 'invokestatic';

  for (let taken = 0; taken < effect.pops && topIndex - taken >= 0; taken++) {
    roles[topIndex - taken] = isCall ? `→ arg ${String(effect.pops - 1 - taken)}` : '→ operand';
  }

  const survivor = topIndex - effect.pops;
  if (survivor >= 0) {
    const consumer = consumerOf(
      methodOf(frame),
      instruction.offset,
      frame.operandStack.length,
      survivor,
    );
    if (consumer !== undefined) {
      roles[survivor] = `waiting for ${consumer}`;
    }
  }

  return roles;
}

/** LineNumberTable lookup: the entry with the largest `startPc <= pc` wins. */
export function lineForOffset(method: MockMethod, offset: number): number | undefined {
  let best: number | undefined;
  let bestStart = -1;
  for (const entry of method.lineNumberTable) {
    if (entry.startPc <= offset && entry.startPc > bestStart) {
      bestStart = entry.startPc;
      best = entry.lineNumber;
    }
  }
  return best;
}

export interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

/** Byte offsets of every instruction that maps to `line` — shown as `pc 7–15` in the footer. */
export function offsetsForLine(method: MockMethod, line: number): OffsetRange | undefined {
  const offsets = method.instructions
    .map((instruction) => instruction.offset)
    .filter((offset) => lineForOffset(method, offset) === line);

  const from = offsets[0];
  const to = offsets.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

/** Spells out the mapping rule for the current pc, so the footer reads as a decision. */
export function lineMappingNote(method: MockMethod, pc: number): string | undefined {
  const line = lineForOffset(method, pc);
  return line === undefined
    ? undefined
    : `LineNumberTable · largest startPc ≤ ${String(pc)} → line ${String(line)}`;
}

/** javap-style trailing comments, keyed by instruction offset. */
export function commentsFor(method: MockMethod): ReadonlyMap<number, string> {
  const comments = new Map<number, string>();
  for (const instruction of method.instructions) {
    const index = instruction.operands[0];
    if (!hasConstantPoolOperand(instruction) || index === undefined) {
      continue;
    }
    const constant = mockConstantPool.get(index);
    if (constant !== undefined) {
      comments.set(instruction.offset, constant.comment);
    }
  }
  return comments;
}

/** Offsets of `method` that no snapshot in the history ever reaches — dead code in this run. */
export function deadOffsetsOf(method: MockMethod): ReadonlySet<number> {
  const reached = new Set<number>();
  for (const snapshot of mockHistory) {
    const frame = snapshot.callStack.at(-1);
    const instruction = snapshot.currentInstruction;
    if (
      frame?.methodName === method.name &&
      frame.methodDescriptor === method.descriptor &&
      instruction !== undefined
    ) {
      reached.add(instruction.offset);
    }
  }
  return new Set(
    method.instructions
      .map((instruction) => instruction.offset)
      .filter((offset) => !reached.has(offset)),
  );
}

/** Call stack depth per step — the background chart of the scrubber. */
export const mockDepths: readonly number[] = mockHistory.map(
  (snapshot) => snapshot.callStack.length,
);
