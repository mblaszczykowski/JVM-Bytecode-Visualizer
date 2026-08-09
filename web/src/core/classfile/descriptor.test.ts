import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import {
  formatJvmType,
  parseFieldDescriptor,
  parseMethodDescriptor,
  type JvmType,
} from './descriptor';
import { isClassFileError } from './errors';

const int: JvmType = { kind: 'primitive', name: 'int' };

describe('parseMethodDescriptor', () => {
  it('parses the fixture descriptor: (I)I', () => {
    expect(parseMethodDescriptor('(I)I')).toEqual({ params: [int], returnType: int });
  });

  it('parses multiple parameters: (II)I', () => {
    expect(parseMethodDescriptor('(II)I')).toEqual({ params: [int, int], returnType: int });
  });

  it('parses an empty parameter list and a void return type: ()V', () => {
    expect(parseMethodDescriptor('()V')).toEqual({ params: [], returnType: { kind: 'void' } });
  });

  it('parses the main descriptor: ([Ljava/lang/String;)V', () => {
    expect(parseMethodDescriptor('([Ljava/lang/String;)V')).toEqual({
      params: [{ kind: 'array', elementType: { kind: 'class', className: 'java/lang/String' } }],
      returnType: { kind: 'void' },
    });
  });

  it('parses the full base type grammar (JVMS §4.3.2)', () => {
    const { params, returnType } = parseMethodDescriptor('(BCDFIJSZ)J');

    expect(params.map((param) => formatJvmType(param))).toEqual([
      'byte',
      'char',
      'double',
      'float',
      'int',
      'long',
      'short',
      'boolean',
    ]);
    expect(returnType).toEqual({ kind: 'primitive', name: 'long' });
  });

  it('parses multi-dimensional arrays as nested types', () => {
    const { params, returnType } = parseMethodDescriptor('([[I)[[[Ljava/lang/Object;');

    expect(params).toEqual([{ kind: 'array', elementType: { kind: 'array', elementType: int } }]);
    expect(formatJvmType(returnType)).toBe('java.lang.Object[][][]');
  });

  it('distinguishes object types whose names start with base type characters', () => {
    expect(parseMethodDescriptor('(LI;LJava;)LB;')).toEqual({
      params: [
        { kind: 'class', className: 'I' },
        { kind: 'class', className: 'Java' },
      ],
      returnType: { kind: 'class', className: 'B' },
    });
  });
});

describe('parseMethodDescriptor: errors', () => {
  const cases = [
    { descriptor: '', position: 0, why: 'empty descriptor' },
    { descriptor: 'II)I', position: 0, why: 'missing opening parenthesis' },
    { descriptor: '(II', position: 3, why: 'missing closing parenthesis' },
    { descriptor: '(I)', position: 3, why: 'missing return type' },
    { descriptor: '(I)IJ', position: 4, why: 'trailing characters' },
    { descriptor: '(V)I', position: 1, why: 'void as a parameter' },
    { descriptor: '(L)V', position: 1, why: 'unterminated object type' },
    { descriptor: '(L;)V', position: 1, why: 'empty class name' },
    { descriptor: '(Ljava/lang/String)V', position: 1, why: 'object type without a semicolon' },
    { descriptor: '(X)V', position: 1, why: 'unknown type character' },
    { descriptor: '([)V', position: 2, why: 'array without a component type' },
  ];

  for (const { descriptor, position, why } of cases) {
    it(`rejects "${descriptor}": ${why} (position ${String(position)})`, () => {
      expect(expectClassFileError(() => parseMethodDescriptor(descriptor))).toMatchObject({
        kind: 'malformed-descriptor',
        descriptor,
        position,
      });
    });
  }

  it('rejects an array with more than 255 dimensions (JVMS §4.3.2)', () => {
    const tooDeep = `(${'['.repeat(256)}I)V`;

    expect(expectClassFileError(() => parseMethodDescriptor(tooDeep))).toMatchObject({
      kind: 'malformed-descriptor',
    });
  });

  it('rejects a 100k-dimension array without recursing', () => {
    expect(expectClassFileError(() => parseFieldDescriptor('['.repeat(100_000))).kind).toBe(
      'malformed-descriptor',
    );
  });
});

describe('parseFieldDescriptor', () => {
  it('parses local variable descriptors from a LocalVariableTable', () => {
    expect(parseFieldDescriptor('I')).toEqual(int);
    expect(parseFieldDescriptor('LFactorial;')).toEqual({ kind: 'class', className: 'Factorial' });
    expect(parseFieldDescriptor('[Ljava/lang/String;')).toEqual({
      kind: 'array',
      elementType: { kind: 'class', className: 'java/lang/String' },
    });
  });

  it('rejects void and trailing characters', () => {
    expect(expectClassFileError(() => parseFieldDescriptor('V')).kind).toBe('malformed-descriptor');
    expect(expectClassFileError(() => parseFieldDescriptor('II')).kind).toBe(
      'malformed-descriptor',
    );
  });
});

describe('formatJvmType', () => {
  it('translates internal names into Java source notation', () => {
    expect(formatJvmType({ kind: 'void' })).toBe('void');
    expect(formatJvmType(int)).toBe('int');
    expect(formatJvmType({ kind: 'class', className: 'java/lang/String' })).toBe(
      'java.lang.String',
    );
    expect(formatJvmType({ kind: 'array', elementType: int })).toBe('int[]');
  });
});

describe('parseMethodDescriptor: property test', () => {
  it('returns a result or throws a ClassFileError on any string, never another exception', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (descriptor) => {
        try {
          parseMethodDescriptor(descriptor);
        } catch (error) {
          if (!isClassFileError(error)) {
            throw error;
          }
          expect(error.detail.kind).toBe('malformed-descriptor');
        }
      }),
      { numRuns: 500 },
    );
  });
});
