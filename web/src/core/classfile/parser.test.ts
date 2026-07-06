import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import { isClassFileError } from './errors';
import { parseClassFile } from './parser';
import { ConstantTag, isStatic, type ClassFile, type MethodInfo } from './types';

/**
 * Źródło prawdy dla asercji: `javap -v -p Factorial.class`, pełny zrzut leży obok
 * w `__fixtures__/Factorial.javap.txt`. Fragmenty, na których opierają się testy:
 *
 *   minor version: 0
 *   major version: 65
 *   this_class: #8  // Factorial
 *   super_class: #2 // java/lang/Object
 *   interfaces: 0, fields: 0, methods: 3, attributes: 1
 *   Constant pool:
 *      #1 = Methodref  #2.#3   // java/lang/Object."<init>":()V
 *      #2 = Class      #4      // java/lang/Object
 *      #4 = Utf8       java/lang/Object
 *      #7 = Methodref  #8.#9   // Factorial.factorial:(I)I
 *      #8 = Class      #10     // Factorial
 *      #9 = NameAndType #11:#12
 *     #12 = Utf8       (I)I
 *     #27 = Utf8       Factorial.java     <- ostatni wpis, constant_pool_count = 28
 *
 *   public static void main(java.lang.String[]);   descriptor: ([Ljava/lang/String;)V
 *     Code: stack=1, locals=2, args_size=1
 *        0: iconst_4          // 0x07
 *        1: invokestatic  #7  // 0xb8 0x00 0x07
 *        4: istore_1          // 0x3c
 *        5: return            // 0xb1
 *     LineNumberTable: line 15: 0 | line 16: 5
 *     LocalVariableTable: [0,6) slot 0 args [Ljava/lang/String; | [5,6) slot 1 result I
 *
 *   static int factorial(int);   descriptor: (I)I
 *     Code: stack=3, locals=1, args_size=1
 *        0: iload_0           // 0x1a
 *        1: iconst_1          // 0x04
 *        2: if_icmpgt     7   // 0xa3 0x00 0x05
 *        5: iconst_1          // 0x04
 *        6: ireturn           // 0xac
 *        7: iload_0 / iload_0 / iconst_1 / isub / invokestatic #7 / imul / ireturn
 *     LineNumberTable: line 19: 0 | line 20: 5 | line 22: 7
 *     LocalVariableTable: [0,16) slot 0 n I
 *     StackMapTable: number_of_entries = 1   <- atrybut nieznany parserowi, musi zostać pominięty
 */
const FACTORIAL_CLASS = new URL('./__fixtures__/Factorial.class', import.meta.url);

function factorialBytes(): Uint8Array<ArrayBuffer> {
  // Kopia do świeżego bufora: Buffer z Node bywa widokiem na współdzieloną pulę pamięci.
  return new Uint8Array(readFileSync(FACTORIAL_CLASS));
}

function parseFactorial(): ClassFile {
  return parseClassFile(factorialBytes().buffer);
}

function methodOf(name: string): MethodInfo {
  const method = parseFactorial().methods.find((candidate) => candidate.name === name);
  if (method === undefined) {
    throw new Error(`fixture nie zawiera metody ${name}`);
  }
  return method;
}

describe('parseClassFile — nagłówek fixture Factorial.class', () => {
  it('czyta wersję 65.0 (Java 21, javac --release 21)', () => {
    const classFile = parseFactorial();

    expect(classFile.majorVersion).toBe(65);
    expect(classFile.minorVersion).toBe(0);
  });

  it('rozwiązuje nazwy klasy i nadklasy przez constant pool', () => {
    const classFile = parseFactorial();

    expect(classFile.thisClassName).toBe('Factorial');
    expect(classFile.superClassName).toBe('java/lang/Object');
    expect(classFile.interfaceNames).toEqual([]);
    expect(classFile.fields).toEqual([]);
    // ACC_PUBLIC | ACC_SUPER = 0x0021 (javap: „flags: (0x0021)”).
    expect(classFile.accessFlags).toBe(0x0021);
  });
});

describe('parseClassFile — constant pool fixture', () => {
  it('jest 1-indeksowany i ma constant_pool_count wpisów (slot 0 pusty)', () => {
    const { constantPool } = parseFactorial();

    expect(constantPool).toHaveLength(28);
    expect(constantPool[0]).toBeNull();
    expect(constantPool[27]).toEqual({ tag: ConstantTag.Utf8, value: 'Factorial.java' });
  });

  it('interpretuje tagi wymagane przez MVP', () => {
    const { constantPool } = parseFactorial();

    expect(constantPool[1]).toEqual({
      tag: ConstantTag.Methodref,
      classIndex: 2,
      nameAndTypeIndex: 3,
    });
    expect(constantPool[2]).toEqual({ tag: ConstantTag.Class, nameIndex: 4 });
    expect(constantPool[3]).toEqual({
      tag: ConstantTag.NameAndType,
      nameIndex: 5,
      descriptorIndex: 6,
    });
    expect(constantPool[4]).toEqual({ tag: ConstantTag.Utf8, value: 'java/lang/Object' });
    expect(constantPool[12]).toEqual({ tag: ConstantTag.Utf8, value: '(I)I' });
  });
});

describe('parseClassFile — metody fixture', () => {
  it('zna wszystkie trzy metody, łącznie z wygenerowanym <init>', () => {
    const methods = parseFactorial().methods;

    expect(methods.map((method) => [method.name, method.descriptor])).toEqual([
      ['<init>', '()V'],
      ['main', '([Ljava/lang/String;)V'],
      ['factorial', '(I)I'],
    ]);
  });

  it('czyta flagi dostępu metod', () => {
    // javap: main → (0x0009) ACC_PUBLIC, ACC_STATIC; factorial → (0x0008) ACC_STATIC.
    expect(methodOf('main').accessFlags).toBe(0x0009);
    expect(methodOf('factorial').accessFlags).toBe(0x0008);
    expect(isStatic(methodOf('factorial').accessFlags)).toBe(true);
    expect(isStatic(methodOf('<init>').accessFlags)).toBe(false);
  });

  it('czyta Code metody main zgodnie z javap', () => {
    const code = methodOf('main').code;

    expect(code?.maxStack).toBe(1);
    expect(code?.maxLocals).toBe(2);
    expect(Array.from(code?.code ?? [])).toEqual([0x07, 0xb8, 0x00, 0x07, 0x3c, 0xb1]);
  });

  it('czyta Code metody factorial zgodnie z javap', () => {
    const code = methodOf('factorial').code;

    expect(code?.maxStack).toBe(3);
    expect(code?.maxLocals).toBe(1);
    expect(code?.code).toHaveLength(16);
    // iload_0, iconst_1, if_icmpgt +5 (skok liczony od offsetu opcode'u — plan.md §8 pkt 2).
    expect(Array.from(code?.code.slice(0, 5) ?? [])).toEqual([0x1a, 0x04, 0xa3, 0x00, 0x05]);
    expect(Array.from(code?.code.slice(-2) ?? [])).toEqual([0x68, 0xac]);
  });

  it('czyta LineNumberTable obu metod', () => {
    expect(methodOf('main').code?.lineNumberTable).toEqual([
      { startPc: 0, lineNumber: 15 },
      { startPc: 5, lineNumber: 16 },
    ]);
    expect(methodOf('factorial').code?.lineNumberTable).toEqual([
      { startPc: 0, lineNumber: 19 },
      { startPc: 5, lineNumber: 20 },
      { startPc: 7, lineNumber: 22 },
    ]);
  });

  it('czyta LocalVariableTable z nazwami zmiennych (javac -g)', () => {
    expect(methodOf('factorial').code?.localVariableTable).toEqual([
      { startPc: 0, length: 16, name: 'n', descriptor: 'I', index: 0 },
    ]);
    expect(methodOf('main').code?.localVariableTable).toEqual([
      { startPc: 0, length: 6, name: 'args', descriptor: '[Ljava/lang/String;', index: 0 },
      { startPc: 5, length: 1, name: 'result', descriptor: 'I', index: 1 },
    ]);
  });

  it('pomija atrybuty spoza zakresu (StackMapTable w Code, SourceFile w klasie)', () => {
    // Gdyby pomijanie po attribute_length nie działało, parser rozjechałby się już na
    // StackMapTable w metodzie factorial i nie doczytałby atrybutów klasy (plan.md §8 pkt 4).
    const classFile = parseFactorial();

    expect(classFile.methods).toHaveLength(3);
    expect(methodOf('factorial').code?.localVariableTable).toHaveLength(1);
  });
});

// --- Syntetyczne pliki .class dla przypadków, których fixture nie pokrywa ---------------------

const u2 = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];
const u4 = (value: number): number[] => [...u2((value >>> 16) & 0xffff), ...u2(value & 0xffff)];
const utf8Entry = (text: string): number[] => [
  ConstantTag.Utf8,
  ...u2(text.length),
  ...Array.from(text, (character) => character.charCodeAt(0)),
];
const classEntry = (nameIndex: number): number[] => [ConstantTag.Class, ...u2(nameIndex)];
const filler = (tag: number, size: number): number[] => [tag, ...new Array<number>(size).fill(0)];
const attribute = (nameIndex: number, body: readonly number[]): number[] => [
  ...u2(nameIndex),
  ...u4(body.length),
  ...body,
];
const member = (
  accessFlags: number,
  nameIndex: number,
  descriptorIndex: number,
  attributes: readonly (readonly number[])[],
): number[] => [
  ...u2(accessFlags),
  ...u2(nameIndex),
  ...u2(descriptorIndex),
  ...u2(attributes.length),
  ...attributes.flat(),
];

interface SyntheticClass {
  readonly constantPool: readonly (readonly number[])[];
  /** Podawane jawnie — musi uwzględniać podwójne sloty Long/Double (plan.md §8 pkt 3). */
  readonly constantPoolCount: number;
  readonly thisClass: number;
  readonly superClass: number;
  /** Indeksy wpisów Class w constant poolu. */
  readonly interfaces?: readonly number[];
  readonly fields?: readonly (readonly number[])[];
  readonly methods?: readonly (readonly number[])[];
  readonly attributes?: readonly (readonly number[])[];
}

function buildClassFile(spec: SyntheticClass): ArrayBuffer {
  const interfaces = spec.interfaces ?? [];
  const fields = spec.fields ?? [];
  const methods = spec.methods ?? [];
  const attributes = spec.attributes ?? [];

  return Uint8Array.from([
    ...u4(0xcafe_babe),
    ...u2(0),
    ...u2(65),
    ...u2(spec.constantPoolCount),
    ...spec.constantPool.flat(),
    ...u2(0x0021),
    ...u2(spec.thisClass),
    ...u2(spec.superClass),
    ...u2(interfaces.length),
    ...interfaces.flatMap((index) => u2(index)),
    ...u2(fields.length),
    ...fields.flat(),
    ...u2(methods.length),
    ...methods.flat(),
    ...u2(attributes.length),
    ...attributes.flat(),
  ]).buffer;
}

describe('parseClassFile — wpisy Long/Double i tagi nieinterpretowane', () => {
  /**
   * Pula z wszystkimi tagami, których MVP nie interpretuje, ale musi umieć przeskoczyć
   * (plan.md §8 pkt 5). Long (#1) i Double (#3) zajmują po dwa sloty — stąd numeracja.
   */
  const kitchenSink = buildClassFile({
    constantPoolCount: 24,
    constantPool: [
      filler(ConstantTag.Long, 8), // #1 (#2 = pusty slot)
      filler(ConstantTag.Double, 8), // #3 (#4 = pusty slot)
      filler(ConstantTag.Float, 4), // #5
      filler(ConstantTag.MethodHandle, 3), // #6
      filler(ConstantTag.MethodType, 2), // #7
      filler(ConstantTag.InvokeDynamic, 4), // #8
      filler(ConstantTag.Dynamic, 4), // #9
      filler(ConstantTag.Module, 2), // #10
      filler(ConstantTag.Package, 2), // #11
      filler(ConstantTag.InterfaceMethodref, 4), // #12
      utf8Entry('Synthetic'), // #13
      classEntry(13), // #14
      utf8Entry('java/lang/Object'), // #15
      classEntry(15), // #16
      [ConstantTag.Integer, 0xff, 0xff, 0xff, 0xff], // #17
      [ConstantTag.String, ...u2(13)], // #18
      utf8Entry('value'), // #19
      utf8Entry('I'), // #20
      [ConstantTag.NameAndType, ...u2(19), ...u2(20)], // #21
      [ConstantTag.Fieldref, ...u2(14), ...u2(21)], // #22
      [ConstantTag.Methodref, ...u2(16), ...u2(21)], // #23
    ],
    thisClass: 14,
    superClass: 16,
  });

  it('zostawia pusty slot po Long i Double, nie przesuwając kolejnych indeksów', () => {
    const { constantPool } = parseClassFile(kitchenSink);

    expect(constantPool).toHaveLength(24);
    expect(constantPool[1]).toEqual({ tag: ConstantTag.Long });
    expect(constantPool[2]).toBeNull();
    expect(constantPool[3]).toEqual({ tag: ConstantTag.Double });
    expect(constantPool[4]).toBeNull();
    expect(constantPool[5]).toEqual({ tag: ConstantTag.Float });
  });

  it('przeskakuje tagi o znanej długości i trafia w kolejne wpisy', () => {
    const { constantPool, thisClassName, superClassName } = parseClassFile(kitchenSink);

    expect(constantPool[13]).toEqual({ tag: ConstantTag.Utf8, value: 'Synthetic' });
    expect(constantPool[17]).toEqual({ tag: ConstantTag.Integer, value: -1 });
    expect(constantPool[22]).toEqual({
      tag: ConstantTag.Fieldref,
      classIndex: 14,
      nameAndTypeIndex: 21,
    });
    expect(thisClassName).toBe('Synthetic');
    expect(superClassName).toBe('java/lang/Object');
  });
});

describe('parseClassFile — pomijanie nieznanych atrybutów na każdym poziomie', () => {
  const BOGUS = 12;
  const codeBody = [
    ...u2(2), // max_stack
    ...u2(1), // max_locals
    ...u4(2), // code_length
    0x03,
    0xb1, // iconst_0, return
    ...u2(1), // exception_table_length — czytana i ignorowana
    ...u2(0),
    ...u2(2),
    ...u2(0),
    ...u2(0),
    ...u2(3), // attributes_count wewnątrz Code
    ...attribute(BOGUS, [0xff]),
    ...attribute(10, [...u2(1), ...u2(0), ...u2(7)]), // LineNumberTable: pc 0 → linia 7
    ...attribute(11, [...u2(1), ...u2(0), ...u2(2), ...u2(13), ...u2(6), ...u2(0)]), // LocalVariableTable: x/I w slocie 0
  ];

  const withBogusAttributes = buildClassFile({
    constantPoolCount: 14,
    constantPool: [
      utf8Entry('Synth'), // #1
      classEntry(1), // #2
      utf8Entry('java/lang/Object'), // #3
      classEntry(3), // #4
      utf8Entry('f'), // #5
      utf8Entry('I'), // #6
      utf8Entry('m'), // #7
      utf8Entry('()V'), // #8
      utf8Entry('Code'), // #9
      utf8Entry('LineNumberTable'), // #10
      utf8Entry('LocalVariableTable'), // #11
      utf8Entry('Bogus'), // #12
      utf8Entry('x'), // #13
    ],
    thisClass: 2,
    superClass: 4,
    fields: [member(0x0002, 5, 6, [attribute(BOGUS, [0xaa, 0xbb, 0xcc]), attribute(BOGUS, [])])],
    methods: [
      member(0x0008, 7, 8, [
        attribute(BOGUS, [0x01, 0x02]),
        attribute(9, codeBody),
        attribute(BOGUS, []),
      ]),
    ],
    attributes: [attribute(BOGUS, [1, 2, 3, 4])],
  });

  it('czyta pole strukturalnie i pomija jego atrybuty', () => {
    expect(parseClassFile(withBogusAttributes).fields).toEqual([
      { name: 'f', descriptor: 'I', accessFlags: 0x0002 },
    ]);
  });

  it('znajduje Code między nieznanymi atrybutami metody', () => {
    const [method] = parseClassFile(withBogusAttributes).methods;

    expect(method?.name).toBe('m');
    expect(method?.code?.maxStack).toBe(2);
    expect(method?.code?.maxLocals).toBe(1);
    expect(Array.from(method?.code?.code ?? [])).toEqual([0x03, 0xb1]);
  });

  it('czyta tabele wewnątrz Code mimo nieznanego atrybutu zagnieżdżonego', () => {
    const [method] = parseClassFile(withBogusAttributes).methods;

    expect(method?.code?.lineNumberTable).toEqual([{ startPc: 0, lineNumber: 7 }]);
    expect(method?.code?.localVariableTable).toEqual([
      { startPc: 0, length: 2, name: 'x', descriptor: 'I', index: 0 },
    ]);
  });
});

describe('parseClassFile — metody bez Code i Code bez tablic debugowych', () => {
  const buffer = buildClassFile({
    constantPoolCount: 7,
    constantPool: [
      utf8Entry('Synth'), // #1
      classEntry(1), // #2
      utf8Entry('abstrakcyjna'), // #3
      utf8Entry('()V'), // #4
      utf8Entry('Code'), // #5
      utf8Entry('bezDebugu'), // #6
    ],
    thisClass: 2,
    superClass: 0,
    methods: [
      // ACC_ABSTRACT — JVMS §4.6 zabrania takiej metodzie mieć atrybut Code.
      member(0x0400, 3, 4, []),
      // Code bez LineNumberTable/LocalVariableTable, czyli klasa skompilowana bez -g.
      member(0x0008, 6, 4, [
        attribute(5, [...u2(1), ...u2(0), ...u4(1), 0xb1, ...u2(0), ...u2(0)]),
      ]),
    ],
  });

  it('zostawia code niezdefiniowane dla metody abstrakcyjnej', () => {
    const [abstractMethod] = parseClassFile(buffer).methods;

    expect(abstractMethod?.name).toBe('abstrakcyjna');
    expect(abstractMethod?.code).toBeUndefined();
    expect(abstractMethod && 'code' in abstractMethod).toBe(false);
  });

  it('pomija opcjonalne tablice, gdy Code ich nie zawiera', () => {
    const method = parseClassFile(buffer).methods[1];

    expect(method?.code?.maxStack).toBe(1);
    expect(method?.code?.lineNumberTable).toBeUndefined();
    expect(method?.code?.localVariableTable).toBeUndefined();
  });
});

describe('parseClassFile — interfejsy', () => {
  it('rozwiązuje nazwy implementowanych interfejsów', () => {
    const buffer = buildClassFile({
      constantPoolCount: 7,
      constantPool: [
        utf8Entry('Synth'), // #1
        classEntry(1), // #2
        utf8Entry('java/lang/Object'), // #3
        classEntry(3), // #4
        utf8Entry('java/lang/Runnable'), // #5
        classEntry(5), // #6
      ],
      thisClass: 2,
      superClass: 4,
      interfaces: [6],
    });

    expect(parseClassFile(buffer).interfaceNames).toEqual(['java/lang/Runnable']);
  });
});

describe('parseClassFile — błędy', () => {
  it('odrzuca plik bez magic 0xCAFEBABE', () => {
    const buffer = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 65]).buffer;

    expect(expectClassFileError(() => parseClassFile(buffer))).toEqual({
      kind: 'bad-magic',
      offset: 0,
      found: 0xdead_beef,
    });
  });

  it('odrzuca pusty bufor jako truncated na magic', () => {
    expect(expectClassFileError(() => parseClassFile(new ArrayBuffer(0)))).toMatchObject({
      kind: 'truncated',
      offset: 0,
      context: 'magic',
    });
  });

  it('zgłasza truncated z offsetem, gdy plik urywa się w środku constant poolu', () => {
    // 12 bajtów = nagłówek (10 B) + tag wpisu #1 (Methodref) + jeden bajt class_index.
    const truncated = factorialBytes().slice(0, 12);

    expect(expectClassFileError(() => parseClassFile(truncated.buffer))).toEqual({
      kind: 'truncated',
      offset: 11,
      context: 'constant_pool[1].class_index',
      bytesNeeded: 2,
      bytesAvailable: 1,
    });
  });

  it('odrzuca constant_pool_count = 0 (pula jest 1-indeksowana)', () => {
    const buffer = buildClassFile({
      constantPoolCount: 0,
      constantPool: [],
      thisClass: 0,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'malformed-structure',
      offset: 8,
    });
  });

  it('zgłasza unknown-constant-tag z offsetem i numerem wpisu', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [[2]], // tag 2 nie istnieje w JVMS §4.4
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toEqual({
      kind: 'unknown-constant-tag',
      offset: 10,
      tag: 2,
      constantPoolIndex: 1,
    });
  });

  it('zgłasza bad-index, gdy this_class nie wskazuje wpisu Class', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [utf8Entry('X')],
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'bad-index',
      offset: 16,
      index: 1,
      expected: 'Class',
      context: 'this_class',
    });
  });

  it('zgłasza bad-index dla indeksu spoza puli i dla pustego slotu', () => {
    const outOfRange = buildClassFile({
      constantPoolCount: 2,
      constantPool: [utf8Entry('X')],
      thisClass: 99,
      superClass: 0,
    });
    const emptySlot = buildClassFile({
      constantPoolCount: 3,
      constantPool: [filler(ConstantTag.Long, 8)],
      thisClass: 2, // drugi slot wpisu Long — pusty
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(outOfRange)).kind).toBe('bad-index');
    expect(expectClassFileError(() => parseClassFile(emptySlot)).kind).toBe('bad-index');
  });

  it('zgłasza bad-index, gdy Class.name_index nie wskazuje Utf8', () => {
    const buffer = buildClassFile({
      constantPoolCount: 3,
      constantPool: [classEntry(2), classEntry(1)],
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'bad-index',
      expected: 'Utf8',
      context: 'this_class → Class.name_index',
    });
  });

  it('odrzuca Code o zerowej długości kodu (JVMS §4.7.3)', () => {
    const emptyCode = buildClassFile({
      constantPoolCount: 7,
      constantPool: [
        utf8Entry('Synth'), // #1
        classEntry(1), // #2
        utf8Entry('m'), // #3
        utf8Entry('()V'), // #4
        utf8Entry('Code'), // #5
        utf8Entry('java/lang/Object'), // #6
      ],
      thisClass: 2,
      superClass: 0,
      methods: [
        member(0x0008, 3, 4, [attribute(5, [...u2(1), ...u2(1), ...u4(0), ...u2(0), ...u2(0)])]),
      ],
    });

    expect(expectClassFileError(() => parseClassFile(emptyCode))).toMatchObject({
      kind: 'malformed-structure',
    });
  });

  it('zgłasza malformed-utf8 na nieprawidłowej sekwencji bajtów', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [[ConstantTag.Utf8, ...u2(2), 0xf0, 0x9f]], // 4-bajtowa forma jest zakazana
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'malformed-utf8',
      constantPoolIndex: 1,
    });
  });
});

describe('parseClassFile — dekodowanie zmodyfikowanego UTF-8 (JVMS §4.4.7)', () => {
  function classWithName(nameBytes: readonly number[]): ArrayBuffer {
    return buildClassFile({
      constantPoolCount: 3,
      constantPool: [[ConstantTag.Utf8, ...u2(nameBytes.length), ...nameBytes], classEntry(1)],
      thisClass: 2,
      superClass: 0,
    });
  }

  it('dekoduje sekwencje dwu- i trzybajtowe', () => {
    // 0xC0 0x80 = U+0000, 0xC5 0xBC = U+017C (ż), 0xE2 0x82 0xAC = U+20AC (€)
    const buffer = classWithName([0x41, 0xc0, 0x80, 0xc5, 0xbc, 0xe2, 0x82, 0xac]);

    expect(parseClassFile(buffer).thisClassName).toBe('A\u0000\u017c\u20ac');
  });

  it('dekoduje znaki spoza BMP zapisane parą surogatów (forma sześciobajtowa)', () => {
    // U+1F600 = surogaty D83D DE00 → 0xED 0xA0 0xBD 0xED 0xB8 0x80
    const buffer = classWithName([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);

    expect(parseClassFile(buffer).thisClassName).toBe('\u{1f600}');
  });

  it('odrzuca goły bajt 0x00 (U+0000 musi być zapisane jako 0xC0 0x80)', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0x41, 0x00])))).toMatchObject({
      kind: 'malformed-utf8',
    });
  });

  it('odrzuca sekwencję urwaną na końcu wpisu', () => {
    // 0xC5 zapowiada dwa bajty, a wpis kończy się po pierwszym.
    expect(expectClassFileError(() => parseClassFile(classWithName([0xc5])))).toMatchObject({
      kind: 'malformed-utf8',
      offset: 14,
      reason: 'sekwencja wielobajtowa urwana na końcu wpisu',
    });
  });

  it('odrzuca nieprawidłowy bajt kontynuacji', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0xc5, 0x41])))).toMatchObject({
      kind: 'malformed-utf8',
      offset: 14,
    });
  });
});

describe('parseClassFile — property test odporności (plan.md §9 Faza 1)', () => {
  function parseIsSafe(bytes: Uint8Array): void {
    try {
      // slice() daje kopię we własnym ArrayBufferze — fast-check zwraca widoki współdzielone.
      parseClassFile(bytes.slice().buffer);
    } catch (error) {
      if (!isClassFileError(error)) {
        throw error;
      }
    }
  }

  it('na losowych bajtach nie rzuca niczego poza ClassFileError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        parseIsSafe(bytes);
      }),
      { numRuns: 500 },
    );
  });

  it('na losowych bajtach z poprawnym magic nie rzuca niczego poza ClassFileError', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (tail) => {
        parseIsSafe(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, ...tail]));
      }),
      { numRuns: 500 },
    );
  });

  it('każdy skrócony fixture kończy się ClassFileError, nigdy wyjątkiem środowiska', () => {
    const full = factorialBytes();

    fc.assert(
      fc.property(fc.integer({ min: 0, max: full.length - 1 }), (length) => {
        // Każde obcięcie zabiera bajty jakiejś struktury — poprawny plik kończy się
        // dokładnie na ostatnim atrybucie klasy, więc każdy prefiks musi być „truncated”.
        const detail = expectClassFileError(() => parseClassFile(full.slice(0, length).buffer));
        expect(detail.kind).toBe('truncated');
      }),
      { numRuns: 200 },
    );
  });
});
