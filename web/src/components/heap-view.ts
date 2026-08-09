import type { HeapObject, StackFrame } from '../core/interpreter/types';

export function objectLabel(object: HeapObject, handle: number): string {
  return object.kind === 'int-array'
    ? `int[${String(object.length)}]@${String(handle)}`
    : `${object.className}@${String(handle)}`;
}

export function referenceLabel(heap: readonly HeapObject[], handle: number | undefined): string {
  const object = handle === undefined ? undefined : heap[handle];
  return object === undefined || handle === undefined ? 'null' : objectLabel(object, handle);
}

export function cellValuesOf(object: HeapObject): readonly number[] {
  return object.kind === 'int-array' ? object.elements : object.fields.map((field) => field.value);
}

export interface HeapFocus {
  readonly handle: number;
  readonly index: number;
  readonly mode: 'read' | 'write';
}

interface Addressing {
  readonly handleDepth: number;
  readonly indexDepth: number;
  readonly mode: 'read' | 'write';
}

const ADDRESSING: Readonly<Record<string, Addressing>> = {
  iaload: { handleDepth: 2, indexDepth: 1, mode: 'read' },
  iastore: { handleDepth: 3, indexDepth: 2, mode: 'write' },
};

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

  const kind = frame.operandKinds?.[stack.length - addressing.handleDepth];
  if (kind !== undefined && kind !== 'ref') {
    return undefined;
  }

  const object = heap[handle];
  if (object?.kind !== 'int-array' || index < 0 || index >= object.length) {
    return undefined;
  }
  return { handle, index, mode: addressing.mode };
}
