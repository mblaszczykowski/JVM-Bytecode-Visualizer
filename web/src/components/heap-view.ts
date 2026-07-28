/**
 * How the heap of a snapshot reads on screen: what an array is called, what a reference points
 * at, and which single element the instruction about to run is going to touch.
 *
 * All of it comes from the snapshot itself — the handles on the operand stack and the kinds
 * that say which of those numbers are references — so no example is special-cased.
 */

import type { ArrayObject, StackFrame } from '../core/interpreter/types';

/** `int[5]@0`: the element type, the length, and the handle that names it on the stack. */
export function arrayLabel(array: ArrayObject, handle: number): string {
  return `int[${String(array.length)}]@${String(handle)}`;
}

/** What a `ref` value reads as: the array it points at, or `null` when it points at nothing. */
export function referenceLabel(heap: readonly ArrayObject[], handle: number | undefined): string {
  const array = handle === undefined ? undefined : heap[handle];
  return array === undefined || handle === undefined ? 'null' : arrayLabel(array, handle);
}

export interface HeapFocus {
  /** Index into the heap of the array being touched. */
  readonly handle: number;
  readonly index: number;
  readonly mode: 'read' | 'write';
}

interface Addressing {
  /** Distance of the array reference from the top of the operand stack, counting from 1. */
  readonly handleDepth: number;
  readonly indexDepth: number;
  readonly mode: 'read' | 'write';
}

/**
 * JVMS §6.5 lays the operands out as `…, arrayref, index` for `iaload` and
 * `…, arrayref, index, value` for `iastore`, so the array is one cell further down when a
 * value is being stored.
 */
const ADDRESSING: Readonly<Record<string, Addressing>> = {
  iaload: { handleDepth: 2, indexDepth: 1, mode: 'read' },
  iastore: { handleDepth: 3, indexDepth: 2, mode: 'write' },
};

/**
 * The one element the current instruction reads or writes, or `undefined` when it touches no
 * array at all. An index outside the array is left unmarked: the run is about to stop there
 * with an ArrayIndexOutOfBoundsException, and there is no cell to point at.
 */
export function heapFocusOf(
  mnemonic: string | undefined,
  frame: StackFrame | undefined,
  heap: readonly ArrayObject[],
): HeapFocus | undefined {
  const addressing = mnemonic === undefined ? undefined : ADDRESSING[mnemonic];
  if (addressing === undefined || frame === undefined) {
    return undefined;
  }

  const stack = frame.operandStack;
  const handle = stack[stack.length - addressing.handleDepth];
  const index = stack[stack.length - addressing.indexDepth];
  if (handle === undefined || index === undefined) {
    return undefined;
  }

  // The kinds are optional in the contract; when they are there they settle whether that
  // number really is a reference rather than an int that happens to look like a handle.
  const kind = frame.operandKinds?.[stack.length - addressing.handleDepth];
  if (kind !== undefined && kind !== 'ref') {
    return undefined;
  }

  const array = heap[handle];
  if (array === undefined || index < 0 || index >= array.length) {
    return undefined;
  }
  return { handle, index, mode: addressing.mode };
}
