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
  it('parsuje deskryptor z fixture: (I)I', () => {
    expect(parseMethodDescriptor('(I)I')).toEqual({ params: [int], returnType: int });
  });

  it('parsuje wiele parametrów: (II)I', () => {
    expect(parseMethodDescriptor('(II)I')).toEqual({ params: [int, int], returnType: int });
  });

  it('parsuje brak parametrów i zwrotkę void: ()V', () => {
    expect(parseMethodDescriptor('()V')).toEqual({ params: [], returnType: { kind: 'void' } });
  });

  it('parsuje deskryptor main: ([Ljava/lang/String;)V', () => {
    expect(parseMethodDescriptor('([Ljava/lang/String;)V')).toEqual({
      params: [{ kind: 'array', elementType: { kind: 'class', className: 'java/lang/String' } }],
      returnType: { kind: 'void' },
    });
  });

  it('zna pełną gramatykę typów bazowych (JVMS §4.3.2), nie tylko int', () => {
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

  it('parsuje tablice wielowymiarowe jako zagnieżdżone typy', () => {
    const { params, returnType } = parseMethodDescriptor('([[I)[[[Ljava/lang/Object;');

    expect(params).toEqual([{ kind: 'array', elementType: { kind: 'array', elementType: int } }]);
    expect(formatJvmType(returnType)).toBe('java.lang.Object[][][]');
  });

  it('rozróżnia typy obiektowe o nazwach zaczynających się od znaków typów bazowych', () => {
    expect(parseMethodDescriptor('(LI;LJava;)LB;')).toEqual({
      params: [
        { kind: 'class', className: 'I' },
        { kind: 'class', className: 'Java' },
      ],
      returnType: { kind: 'class', className: 'B' },
    });
  });
});

describe('parseMethodDescriptor — błędy', () => {
  const cases = [
    { descriptor: '', position: 0, why: 'pusty deskryptor' },
    { descriptor: 'II)I', position: 0, why: 'brak nawiasu otwierającego' },
    { descriptor: '(II', position: 3, why: 'brak nawiasu zamykającego' },
    { descriptor: '(I)', position: 3, why: 'brak typu zwracanego' },
    { descriptor: '(I)IJ', position: 4, why: 'nadmiarowe znaki na końcu' },
    { descriptor: '(V)I', position: 1, why: 'void jako parametr' },
    { descriptor: '(L)V', position: 1, why: 'typ obiektowy bez zamknięcia' },
    { descriptor: '(L;)V', position: 1, why: 'pusta nazwa klasy' },
    { descriptor: '(Ljava/lang/String)V', position: 1, why: 'typ obiektowy bez średnika' },
    { descriptor: '(X)V', position: 1, why: 'nieznany znak typu' },
    { descriptor: '([)V', position: 2, why: 'tablica bez typu komponentu' },
  ];

  for (const { descriptor, position, why } of cases) {
    it(`odrzuca "${descriptor}" — ${why} (pozycja ${String(position)})`, () => {
      expect(expectClassFileError(() => parseMethodDescriptor(descriptor))).toMatchObject({
        kind: 'malformed-descriptor',
        descriptor,
        position,
      });
    });
  }

  it('odrzuca tablicę o więcej niż 255 wymiarach (JVMS §4.3.2)', () => {
    const tooDeep = `(${'['.repeat(256)}I)V`;

    expect(expectClassFileError(() => parseMethodDescriptor(tooDeep))).toMatchObject({
      kind: 'malformed-descriptor',
    });
  });

  it('nie przewraca się na patologicznie głębokiej tablicy (brak rekurencji po wymiarach)', () => {
    expect(expectClassFileError(() => parseFieldDescriptor('['.repeat(100_000))).kind).toBe(
      'malformed-descriptor',
    );
  });
});

describe('parseFieldDescriptor', () => {
  it('parsuje deskryptory zmiennych lokalnych z LocalVariableTable', () => {
    expect(parseFieldDescriptor('I')).toEqual(int);
    expect(parseFieldDescriptor('LFactorial;')).toEqual({ kind: 'class', className: 'Factorial' });
    expect(parseFieldDescriptor('[Ljava/lang/String;')).toEqual({
      kind: 'array',
      elementType: { kind: 'class', className: 'java/lang/String' },
    });
  });

  it('odrzuca void i nadmiarowe znaki', () => {
    expect(expectClassFileError(() => parseFieldDescriptor('V')).kind).toBe('malformed-descriptor');
    expect(expectClassFileError(() => parseFieldDescriptor('II')).kind).toBe(
      'malformed-descriptor',
    );
  });
});

describe('formatJvmType', () => {
  it('tłumaczy nazwy wewnętrzne na zapis źródłowy Javy', () => {
    expect(formatJvmType({ kind: 'void' })).toBe('void');
    expect(formatJvmType(int)).toBe('int');
    expect(formatJvmType({ kind: 'class', className: 'java/lang/String' })).toBe(
      'java.lang.String',
    );
    expect(formatJvmType({ kind: 'array', elementType: int })).toBe('int[]');
  });
});

describe('parseMethodDescriptor — property test', () => {
  it('na dowolnym stringu kończy się wynikiem albo ClassFileError, nigdy innym wyjątkiem', () => {
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
