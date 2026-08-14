import { describe, expect, it } from 'vitest';

import type { ExternalValue, HeapObject, StackFrame } from '../../core/interpreter';
import { frameOf } from '../../core/interpreter/__fixtures__/snapshots';

import { OPERAND_ADDRESSING } from './opcode-notes';
import { cellValuesOf, describeValue, heapFocusOf, objectLabel } from './heap-view';

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

function frameWith(
  operandStack: readonly number[],
  operandKinds: StackFrame['operandKinds'],
): StackFrame {
  return frameOf({
    methodName: 'sort',
    methodDescriptor: '([I)V',
    pc: 0,
    operandStack,
    operandKinds,
    locals: [],
    localNames: [],
  });
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

describe('describeValue', () => {
  const externals: readonly ExternalValue[] = [
    { className: 'java/io/PrintStream', label: 'System.out' },
  ];

  it('names a value by what it is rather than by the number in the cell', () => {
    expect(describeValue('int', 3, heap, externals)).toBe('3');
    expect(describeValue('ref', 0, heap, externals)).toBe('int[3]@0');
    expect(describeValue('ref', 1, heap, externals)).toBe('Counter@1');
    expect(describeValue('external', 0, heap, externals)).toBe('System.out');
  });

  it('has an answer for a reference that names nothing', () => {
    expect(describeValue('ref', -1, heap, externals)).toBe('null');
    expect(describeValue('external', 4, heap, externals)).toBe('an unknown object');
  });

  it('needs a kind, so a handle can never be rendered as the number it happens to be', () => {
    // @ts-expect-error every recorded value carries its kind, so there is no arm for a missing one
    expect(describeValue(undefined, 0, heap, externals)).not.toBe('0');
    expect(describeValue('ref', 0, heap, externals)).not.toBe('0');
  });
});

describe('heapFocusOf', () => {
  it('reads the array and index an iaload is about to use', () => {
    expect(heapFocusOf('iaload', frameWith([0, 2], ['ref', 'int']), heap)).toEqual({
      handle: 0,
      index: 2,
      mode: 'read',
    });
  });

  it('looks one deeper for iastore, past the value being written', () => {
    expect(heapFocusOf('iastore', frameWith([0, 1, 42], ['ref', 'int', 'int']), heap)).toEqual({
      handle: 0,
      index: 1,
      mode: 'write',
    });
  });

  it('focuses nothing for an instruction that names an object but no element', () => {
    expect(heapFocusOf('arraylength', frameWith([0], ['ref']), heap)).toBeUndefined();
    expect(heapFocusOf('getfield', frameWith([1], ['ref']), heap)).toBeUndefined();
    expect(OPERAND_ADDRESSING.arraylength?.handleDepth).toBe(1);
    expect(OPERAND_ADDRESSING.arraylength?.indexDepth).toBeUndefined();
  });

  it('focuses nothing for an instruction that addresses no object at all', () => {
    expect(heapFocusOf('iadd', frameWith([1, 2], ['int', 'int']), heap)).toBeUndefined();
    expect(heapFocusOf(undefined, frameWith([0, 1], ['ref', 'int']), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', undefined, heap)).toBeUndefined();
  });

  it('refuses an index outside the array and a handle that is not an array', () => {
    expect(heapFocusOf('iaload', frameWith([0, 3], ['ref', 'int']), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', frameWith([0, -1], ['ref', 'int']), heap)).toBeUndefined();
    expect(heapFocusOf('iaload', frameWith([1, 0], ['ref', 'int']), heap)).toBeUndefined();
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
    expect(heapFocusOf('iaload', frameWith([0], ['ref']), heap)).toBeUndefined();
    expect(heapFocusOf('iastore', frameWith([0, 1], ['ref', 'int']), heap)).toBeUndefined();
  });
});
