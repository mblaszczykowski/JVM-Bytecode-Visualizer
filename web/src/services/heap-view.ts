import type { HeapObject, StackFrame } from '../core/interpreter';

import { OPERAND_ADDRESSING } from './derivations';

export function objectLabel(object: HeapObject, handle: number): string {
  return object.kind === 'int-array'
    ? `int[${String(object.length)}]@${String(handle)}`
    : `${object.className}@${String(handle)}`;
}

export function objectTypeName(object: HeapObject): string {
  return object.kind === 'int-array' ? 'int[]' : object.className;
}

export function cellValuesOf(object: HeapObject): readonly number[] {
  return object.kind === 'int-array' ? object.elements : object.fields.map((field) => field.value);
}

export interface HeapFocus {
  readonly handle: number;
  readonly index: number;
  readonly mode: 'read' | 'write';
}

export function heapFocusOf(
  mnemonic: string | undefined,
  frame: StackFrame | undefined,
  heap: readonly HeapObject[],
): HeapFocus | undefined {
  const addressing = mnemonic === undefined ? undefined : OPERAND_ADDRESSING[mnemonic];
  if (addressing === undefined || frame === undefined) {
    return undefined;
  }

  const { handleDepth, indexDepth, access } = addressing;
  if (handleDepth === undefined || indexDepth === undefined) {
    return undefined;
  }

  const stack = frame.operandStack;
  const handle = stack[stack.length - handleDepth];
  const index = stack[stack.length - indexDepth];
  if (handle === undefined || index === undefined) {
    return undefined;
  }

  const kind = frame.operandKinds?.[stack.length - handleDepth];
  if (kind !== undefined && kind !== 'ref') {
    return undefined;
  }

  const object = heap[handle];
  if (object?.kind !== 'int-array' || index < 0 || index >= object.length) {
    return undefined;
  }
  return { handle, index, mode: access ?? 'read' };
}
