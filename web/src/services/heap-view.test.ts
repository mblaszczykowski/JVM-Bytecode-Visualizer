import { describe, expect, it } from 'vitest';

import type { HeapObject, StackFrame } from '../core/interpreter';

import { OPERAND_ADDRESSING } from './opcode-notes';
import { cellValuesOf, heapFocusOf, objectLabel } from './heap-view';

const array: HeapObject = { kind: 'int-array', length: 3, elements: [7, 8, 9] };

const instance: HeapObject = {
  kind: 'instance',
  className: 'Counter',
  fields: [
    { name: 'count', descriptor: 'I', value: 4, kind: 'int' },
    { name: 'samples', descriptor: '[I', value: 0, kind: 'ref' },
  ],
};

const heap: readonly HeapObject[] = [array, instance];

function frameWith(operandStack: readonly number[], operandKinds?: StackFrame['operandKinds']) {
  const frame: StackFrame = {
    methodName: 'sort',
    methodDescriptor: '([I)V',
    pc: 0,
    operandStack,
    locals: [],
    localNames: [],
    ...(operandKinds === undefined ? {} : { operandKinds }),
  };
  return frame;
}

describe('objectLabel', () => {
  it('names an array by its length and an instance by its class', () => {
    expect(objectLabel(array, 0)).toBe('int[3]@0');
    expect(objectLabel(instance, 1)).toBe('Counter@1');
  });
});

describe('cellValuesOf', () => {
  it('reads the elements of an array and the field values of an instance', () => {
    expect(cellValuesOf(array)).toEqual([7, 8, 9]);
    expect(cellValuesOf(instance)).toEqual([4, 0]);
  });
});

describe('heapFocusOf', () => {
  it('reads the array and index an iaload is about to use', () => {
    expect(heapFocusOf('iaload', frameWith([0, 2]), heap)).toEqual({
      handle: 0,
      index: 2,
      mode: 'read',
    });
  });

  it('looks one deeper for iastore, past the value being written', () => {
    expect(heapFocusOf('iastore', frameWith([0, 1, 42]), heap)).toEqual({
      handle: 0,
      index: 1,
      mode: 'write',
    });
  });

  it('focuses nothing for an instruction that names an object but no element', () => {
    expect(heapFocusOf('arraylength', frameWith([0]), heap)).toBeUndefined();
    expect(heapFocusOf('getfield', frameWith([1]), heap)).toBeUndefined();
    expect(OPERAND_ADDRESSING.arraylength?.handleDepth).toBe(1);
    expect(OPERAND_ADDRESSING.arraylength?.indexDepth).toBeUndefined();
  });

  it('focuses nothing for an instruction that addresses no object at all', () => {
    expect(heapFocusOf('iadd', frameWith([1, 2]), heap)).toBeUndefined();
    expect(heapFocusOf(undefined, frameWith([0, 1]), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', undefined, heap)).toBeUndefined();
  });

  it('refuses an index outside the array and a handle that is not an array', () => {
    expect(heapFocusOf('iaload', frameWith([0, 3]), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', frameWith([0, -1]), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', frameWith([1, 0]), heap)).toBeUndefined();
  });

  it('refuses a slot the frame says holds something other than a reference', () => {
    expect(heapFocusOf('iaload', frameWith([0, 1], ['int', 'int']), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', frameWith([0, 1], ['ref', 'int']), heap)).toEqual({
      handle: 0,
      index: 1,
      mode: 'read',
    });
  });

  it('refuses a stack too shallow to hold the operands', () => {
    expect(heapFocusOf('iaload', frameWith([0]), heap)).toBeUndefined();
    expect(heapFocusOf('iastore', frameWith([0, 1]), heap)).toBeUndefined();
  });
});
