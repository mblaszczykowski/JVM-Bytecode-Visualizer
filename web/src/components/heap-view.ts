/**
 * How the heap of a snapshot reads on screen: what an array is called, what a reference points
 * at, and which single element the instruction about to run is going to touch.
 *
 * All of it comes from the snapshot itself — the handles on the operand stack and the kinds
 * that say which of those numbers are references — so no example is special-cased.
 */

import type { HeapObject, StackFrame } from '../core/interpreter/types';

/** `int[5]@0` or `Node@2`: what the object is, and the handle that names it on the stack. */
export function objectLabel(object: HeapObject, handle: number): string {
  return object.kind === 'int-array'
    ? `int[${String(object.length)}]@${String(handle)}`
    : `${object.className}@${String(handle)}`;
}

/** What a `ref` value reads as: the object it points at, or `null` when it points at nothing. */
export function referenceLabel(heap: readonly HeapObject[], handle: number | undefined): string {
  const object = handle === undefined ? undefined : heap[handle];
  return object === undefined || handle === undefined ? 'null' : objectLabel(object, handle);
}

/**
 * The numbers an object holds, in the order they are drawn: an array's elements, or an
 * instance's field values. The panel flashes a changed cell and does not care which of the two
 * it is looking at, so the difference is resolved here rather than in the rendering.
 */
export function cellValuesOf(object: HeapObject): readonly number[] {
  return object.kind === 'int-array' ? object.elements : object.fields.map((field) => field.value);
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
  heap: readonly HeapObject[],
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

  // Only an array is addressed by index; `iaload` on an instance is a state the verifier
  // rejects, and the run is about to stop rather than light a cell up.
  const object = heap[handle];
  if (object?.kind !== 'int-array' || index < 0 || index >= object.length) {
    return undefined;
  }
  return { handle, index, mode: addressing.mode };
}
