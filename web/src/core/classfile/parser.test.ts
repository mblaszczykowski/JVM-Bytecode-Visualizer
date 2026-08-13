import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import { isClassFileError } from './errors';
import { parseClassFile } from './parser';
import { ConstantTag, isStatic, type ClassFile, type MethodInfo } from './types';

const FACTORIAL_CLASS = new URL('./__fixtures__/Factorial.class', import.meta.url);
const OPCODE_ZOO_CLASS = new URL('../disassembler/__fixtures__/OpcodeZoo.class', import.meta.url);

function factorialBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(FACTORIAL_CLASS));
}

function parseFactorial(): ClassFile {
  return parseClassFile(factorialBytes().buffer);
}

function methodOf(name: string): MethodInfo {
  const method = parseFactorial().methods.find((candidate) => candidate.name === name);
  if (method === undefined) {
    throw new Error(`the fixture has no method named ${name}`);
  }
  return method;
}

describe('parseClassFile: Factorial.class fixture header', () => {
  it('reads version 65.0 (Java 21, javac --release 21)', () => {
    const classFile = parseFactorial();

    expect(classFile.majorVersion).toBe(65);
    expect(classFile.minorVersion).toBe(0);
  });

  it('resolves the class and superclass names through the constant pool', () => {
    const classFile = parseFactorial();

    expect(classFile.thisClassName).toBe('Factorial');
    expect(classFile.superClassName).toBe('java/lang/Object');
    expect(classFile.interfaceNames).toEqual([]);
    expect(classFile.fields).toEqual([]);
    expect(classFile.accessFlags).toBe(0x0021);
  });
});

describe('parseClassFile: fixture constant pool', () => {
  it('is 1-indexed and holds constant_pool_count entries (slot 0 empty)', () => {
    const { constantPool } = parseFactorial();

    expect(constantPool).toHaveLength(28);
    expect(constantPool[0]).toBeNull();
    expect(constantPool[27]).toEqual({ tag: ConstantTag.Utf8, value: 'Factorial.java' });
  });

  it('interprets the tags the parser needs', () => {
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

describe('parseClassFile: fixture methods', () => {
  it('sees all three methods, including the generated <init>', () => {
    const methods = parseFactorial().methods;

    expect(methods.map((method) => [method.name, method.descriptor])).toEqual([
      ['<init>', '()V'],
      ['main', '([Ljava/lang/String;)V'],
      ['factorial', '(I)I'],
    ]);
  });

  it('reads method access flags', () => {
    expect(methodOf('main').accessFlags).toBe(0x0009);
    expect(methodOf('factorial').accessFlags).toBe(0x0008);
    expect(isStatic(methodOf('factorial').accessFlags)).toBe(true);
    expect(isStatic(methodOf('<init>').accessFlags)).toBe(false);
  });

  it('reads the Code of main exactly as javap reports it', () => {
    const code = methodOf('main').code;

    expect(code?.maxStack).toBe(1);
    expect(code?.maxLocals).toBe(2);
    expect(Array.from(code?.code ?? [])).toEqual([0x07, 0xb8, 0x00, 0x07, 0x3c, 0xb1]);
  });

  it('reads the Code of factorial exactly as javap reports it', () => {
    const code = methodOf('factorial').code;

    expect(code?.maxStack).toBe(3);
    expect(code?.maxLocals).toBe(1);
    expect(code?.code).toHaveLength(16);
    expect(Array.from(code?.code.slice(0, 5) ?? [])).toEqual([0x1a, 0x04, 0xa3, 0x00, 0x05]);
    expect(Array.from(code?.code.slice(-2) ?? [])).toEqual([0x68, 0xac]);
  });

  it('reads the LineNumberTable of both methods', () => {
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

  it('reads the LocalVariableTable with variable names (javac -g)', () => {
    expect(methodOf('factorial').code?.localVariableTable).toEqual([
      { startPc: 0, length: 16, name: 'n', descriptor: 'I', index: 0 },
    ]);
    expect(methodOf('main').code?.localVariableTable).toEqual([
      { startPc: 0, length: 6, name: 'args', descriptor: '[Ljava/lang/String;', index: 0 },
      { startPc: 5, length: 1, name: 'result', descriptor: 'I', index: 1 },
    ]);
  });

  it('skips out-of-scope attributes (StackMapTable in Code, SourceFile in the class)', () => {
    const classFile = parseFactorial();

    expect(classFile.methods).toHaveLength(3);
    expect(methodOf('factorial').code?.localVariableTable).toHaveLength(1);
  });
});

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
  readonly constantPoolCount: number;
  readonly thisClass: number;
  readonly superClass: number;
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

describe('parseClassFile: the value constants javac wrote into OpcodeZoo', () => {
  const { constantPool } = parseClassFile(new Uint8Array(readFileSync(OPCODE_ZOO_CLASS)).buffer);

  it('reads the float, long and double the class loads through ldc and ldc2_w', () => {
    expect(constantPool[10]).toEqual({ tag: ConstantTag.Float, value: 1.5 });
    expect(constantPool[11]).toEqual({ tag: ConstantTag.Long, value: 4_294_967_296n });
    expect(constantPool[8]).toEqual({ tag: ConstantTag.Double, value: 0.5 });
  });

  it('leaves the second slot of each eight-byte constant empty (JVMS §4.4.5)', () => {
    expect(constantPool[9]).toBeNull();
    expect(constantPool[12]).toBeNull();
    expect(constantPool[13]).toEqual({ tag: ConstantTag.Class, nameIndex: 14 });
  });
});

describe('parseClassFile: Long/Double entries and the reference tags around them', () => {
  const kitchenSink = buildClassFile({
    constantPoolCount: 24,
    constantPool: [
      [ConstantTag.Long, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00],
      [ConstantTag.Double, 0x3f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      [ConstantTag.Float, 0x3f, 0xc0, 0x00, 0x00],
      [ConstantTag.MethodHandle, 6, ...u2(23)],
      [ConstantTag.MethodType, ...u2(20)],
      [ConstantTag.InvokeDynamic, ...u2(0), ...u2(21)],
      [ConstantTag.Dynamic, ...u2(1), ...u2(21)],
      [ConstantTag.Module, ...u2(13)],
      [ConstantTag.Package, ...u2(13)],
      [ConstantTag.InterfaceMethodref, ...u2(16), ...u2(21)],
      utf8Entry('Synthetic'),
      classEntry(13),
      utf8Entry('java/lang/Object'),
      classEntry(15),
      [ConstantTag.Integer, 0xff, 0xff, 0xff, 0xff],
      [ConstantTag.String, ...u2(13)],
      utf8Entry('value'),
      utf8Entry('I'),
      [ConstantTag.NameAndType, ...u2(19), ...u2(20)],
      [ConstantTag.Fieldref, ...u2(14), ...u2(21)],
      [ConstantTag.Methodref, ...u2(16), ...u2(21)],
    ],
    thisClass: 14,
    superClass: 16,
  });

  it('leaves an empty slot after Long and Double without shifting later indices', () => {
    const { constantPool } = parseClassFile(kitchenSink);

    expect(constantPool).toHaveLength(24);
    expect(constantPool[1]).toEqual({ tag: ConstantTag.Long, value: 4_294_967_296n });
    expect(constantPool[2]).toBeNull();
    expect(constantPool[3]).toEqual({ tag: ConstantTag.Double, value: 0.5 });
    expect(constantPool[4]).toBeNull();
    expect(constantPool[5]).toEqual({ tag: ConstantTag.Float, value: 1.5 });
  });

  it('refuses a long in the last slot, whose second slot does not exist (JVMS §4.4.5)', () => {
    const buffer = buildClassFile({
      constantPoolCount: 5,
      constantPool: [
        utf8Entry('Synth'),
        classEntry(1),
        utf8Entry('java/lang/Object'),
        [ConstantTag.Long, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
      ],
      thisClass: 2,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'malformed-structure',
      reason: expect.stringContaining('last slot') as string,
    });
  });

  it('reads a long that a double could not hold exactly', () => {
    const buffer = buildClassFile({
      constantPoolCount: 5,
      constantPool: [
        [ConstantTag.Long, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        utf8Entry('Synth'),
        classEntry(3),
      ],
      thisClass: 4,
      superClass: 0,
    });

    expect(parseClassFile(buffer).constantPool[1]).toEqual({
      tag: ConstantTag.Long,
      value: 9_223_372_036_854_775_807n,
    });
  });

  it('reads every tag of known length and lands on the following entries', () => {
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

  it('keeps the indices of the tags the interpreter never executes', () => {
    const { constantPool } = parseClassFile(kitchenSink);

    expect(constantPool[6]).toEqual({
      tag: ConstantTag.MethodHandle,
      referenceKind: 6,
      referenceIndex: 23,
    });
    expect(constantPool[7]).toEqual({ tag: ConstantTag.MethodType, descriptorIndex: 20 });
    expect(constantPool[8]).toEqual({
      tag: ConstantTag.InvokeDynamic,
      bootstrapMethodAttrIndex: 0,
      nameAndTypeIndex: 21,
    });
    expect(constantPool[9]).toEqual({
      tag: ConstantTag.Dynamic,
      bootstrapMethodAttrIndex: 1,
      nameAndTypeIndex: 21,
    });
    expect(constantPool[10]).toEqual({ tag: ConstantTag.Module, nameIndex: 13 });
    expect(constantPool[11]).toEqual({ tag: ConstantTag.Package, nameIndex: 13 });
    expect(constantPool[12]).toEqual({
      tag: ConstantTag.InterfaceMethodref,
      classIndex: 16,
      nameAndTypeIndex: 21,
    });
  });
});

describe('parseClassFile: skipping unknown attributes at every level', () => {
  const BOGUS = 12;
  const codeBody = [
    ...u2(2),
    ...u2(1),
    ...u4(2),
    0x03,
    0xb1,
    ...u2(1),
    ...u2(0),
    ...u2(2),
    ...u2(0),
    ...u2(0),
    ...u2(3),
    ...attribute(BOGUS, [0xff]),
    ...attribute(10, [...u2(1), ...u2(0), ...u2(7)]),
    ...attribute(11, [...u2(1), ...u2(0), ...u2(2), ...u2(13), ...u2(6), ...u2(0)]),
  ];

  const withBogusAttributes = buildClassFile({
    constantPoolCount: 14,
    constantPool: [
      utf8Entry('Synth'),
      classEntry(1),
      utf8Entry('java/lang/Object'),
      classEntry(3),
      utf8Entry('f'),
      utf8Entry('I'),
      utf8Entry('m'),
      utf8Entry('()V'),
      utf8Entry('Code'),
      utf8Entry('LineNumberTable'),
      utf8Entry('LocalVariableTable'),
      utf8Entry('Bogus'),
      utf8Entry('x'),
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

  it('reads a field structurally and skips its attributes', () => {
    expect(parseClassFile(withBogusAttributes).fields).toEqual([
      { name: 'f', descriptor: 'I', accessFlags: 0x0002 },
    ]);
  });

  it('finds Code among unknown method attributes', () => {
    const [method] = parseClassFile(withBogusAttributes).methods;

    expect(method?.name).toBe('m');
    expect(method?.code?.maxStack).toBe(2);
    expect(method?.code?.maxLocals).toBe(1);
    expect(Array.from(method?.code?.code ?? [])).toEqual([0x03, 0xb1]);
  });

  it('reads the tables inside Code despite an unknown nested attribute', () => {
    const [method] = parseClassFile(withBogusAttributes).methods;

    expect(method?.code?.lineNumberTable).toEqual([{ startPc: 0, lineNumber: 7 }]);
    expect(method?.code?.localVariableTable).toEqual([
      { startPc: 0, length: 2, name: 'x', descriptor: 'I', index: 0 },
    ]);
  });
});

describe('parseClassFile: methods without Code and Code without debug tables', () => {
  const buffer = buildClassFile({
    constantPoolCount: 7,
    constantPool: [
      utf8Entry('Synth'),
      classEntry(1),
      utf8Entry('abstractMethod'),
      utf8Entry('()V'),
      utf8Entry('Code'),
      utf8Entry('noDebugInfo'),
    ],
    thisClass: 2,
    superClass: 0,
    methods: [
      member(0x0400, 3, 4, []),
      member(0x0008, 6, 4, [
        attribute(5, [...u2(1), ...u2(0), ...u4(1), 0xb1, ...u2(0), ...u2(0)]),
      ]),
    ],
  });

  it('leaves code undefined for an abstract method', () => {
    const [abstractMethod] = parseClassFile(buffer).methods;

    expect(abstractMethod?.name).toBe('abstractMethod');
    expect(abstractMethod?.code).toBeUndefined();
    expect(abstractMethod && 'code' in abstractMethod).toBe(false);
  });

  it('omits the optional tables when Code does not contain them', () => {
    const method = parseClassFile(buffer).methods[1];

    expect(method?.code?.maxStack).toBe(1);
    expect(method?.code?.lineNumberTable).toBeUndefined();
    expect(method?.code?.localVariableTable).toBeUndefined();
    expect(method?.code?.exceptionTable).toBeUndefined();
  });
});

describe('parseClassFile: the exception table (JVMS §4.7.3)', () => {
  const ARITHMETIC = 'java/lang/ArithmeticException';

  const buffer = buildClassFile({
    constantPoolCount: 8,
    constantPool: [
      utf8Entry('Synth'),
      classEntry(1),
      utf8Entry('guarded'),
      utf8Entry('()V'),
      utf8Entry('Code'),
      utf8Entry(ARITHMETIC),
      classEntry(6),
    ],
    thisClass: 2,
    superClass: 0,
    methods: [
      member(0x0008, 3, 4, [
        attribute(5, [
          ...u2(1),
          ...u2(1),
          ...u4(1),
          0xb1,
          ...u2(2),
          ...u2(0),
          ...u2(1),
          ...u2(1),
          ...u2(7),
          ...u2(0),
          ...u2(1),
          ...u2(1),
          ...u2(0),
          ...u2(0),
        ]),
      ]),
    ],
  });

  it('reads every row and resolves the class each one catches', () => {
    expect(parseClassFile(buffer).methods[0]?.code?.exceptionTable).toEqual([
      { startPc: 0, endPc: 1, handlerPc: 1, catchType: ARITHMETIC },
      { startPc: 0, endPc: 1, handlerPc: 1 },
    ]);
  });

  it('leaves catchType off the catch-all row', () => {
    const rows = parseClassFile(buffer).methods[0]?.code?.exceptionTable ?? [];

    expect(rows[1] && 'catchType' in rows[1]).toBe(false);
  });

  it('keeps the rows in the order the class file wrote them', () => {
    const rows = parseClassFile(buffer).methods[0]?.code?.exceptionTable ?? [];

    expect(rows.map((row) => row.catchType)).toEqual([ARITHMETIC, undefined]);
  });
});

describe('parseClassFile: interfaces', () => {
  it('resolves the names of implemented interfaces', () => {
    const buffer = buildClassFile({
      constantPoolCount: 7,
      constantPool: [
        utf8Entry('Synth'),
        classEntry(1),
        utf8Entry('java/lang/Object'),
        classEntry(3),
        utf8Entry('java/lang/Runnable'),
        classEntry(5),
      ],
      thisClass: 2,
      superClass: 4,
      interfaces: [6],
    });

    expect(parseClassFile(buffer).interfaceNames).toEqual(['java/lang/Runnable']);
  });
});

describe('parseClassFile: errors', () => {
  it('rejects a file without the 0xCAFEBABE magic', () => {
    const buffer = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 65]).buffer;

    expect(expectClassFileError(() => parseClassFile(buffer))).toEqual({
      kind: 'bad-magic',
      offset: 0,
      found: 0xdead_beef,
    });
  });

  it('rejects an empty buffer as truncated on magic', () => {
    expect(expectClassFileError(() => parseClassFile(new ArrayBuffer(0)))).toMatchObject({
      kind: 'truncated',
      offset: 0,
      context: 'magic',
    });
  });

  it('reports truncated with an offset when the file ends inside the constant pool', () => {
    const truncated = factorialBytes().slice(0, 12);

    expect(expectClassFileError(() => parseClassFile(truncated.buffer))).toEqual({
      kind: 'truncated',
      offset: 11,
      context: 'constant_pool[1].class_index',
      bytesNeeded: 2,
      bytesAvailable: 1,
    });
  });

  it('rejects constant_pool_count = 0 (the pool is 1-indexed)', () => {
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

  it('reports unknown-constant-tag with an offset and entry number', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [[2]],
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

  it('reports bad-index when this_class does not point at a Class entry', () => {
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

  it('reports bad-index for an out-of-range index and for an empty slot', () => {
    const outOfRange = buildClassFile({
      constantPoolCount: 2,
      constantPool: [utf8Entry('X')],
      thisClass: 99,
      superClass: 0,
    });
    const emptySlot = buildClassFile({
      constantPoolCount: 3,
      constantPool: [filler(ConstantTag.Long, 8)],
      thisClass: 2,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(outOfRange)).kind).toBe('bad-index');
    expect(expectClassFileError(() => parseClassFile(emptySlot)).kind).toBe('bad-index');
  });

  it('reports bad-index when Class.name_index does not point at a Utf8', () => {
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

  it('rejects Code with a zero-length code array (JVMS §4.7.3)', () => {
    const emptyCode = buildClassFile({
      constantPoolCount: 7,
      constantPool: [
        utf8Entry('Synth'),
        classEntry(1),
        utf8Entry('m'),
        utf8Entry('()V'),
        utf8Entry('Code'),
        utf8Entry('java/lang/Object'),
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

  it('reports malformed-utf8 on an invalid byte sequence', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [[ConstantTag.Utf8, ...u2(2), 0xf0, 0x9f]],
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'malformed-utf8',
      constantPoolIndex: 1,
    });
  });
});

describe('parseClassFile: modified UTF-8 decoding (JVMS §4.4.7)', () => {
  function classWithName(nameBytes: readonly number[]): ArrayBuffer {
    return buildClassFile({
      constantPoolCount: 3,
      constantPool: [[ConstantTag.Utf8, ...u2(nameBytes.length), ...nameBytes], classEntry(1)],
      thisClass: 2,
      superClass: 0,
    });
  }

  it('decodes two- and three-byte sequences', () => {
    const buffer = classWithName([0x41, 0xc0, 0x80, 0xc5, 0xbc, 0xe2, 0x82, 0xac]);

    expect(parseClassFile(buffer).thisClassName).toBe('A\u0000\u017c\u20ac');
  });

  it('decodes supplementary characters written as a surrogate pair (six-byte form)', () => {
    const buffer = classWithName([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);

    expect(parseClassFile(buffer).thisClassName).toBe('\u{1f600}');
  });

  it('rejects a bare 0x00 byte (U+0000 must be encoded as 0xC0 0x80)', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0x41, 0x00])))).toMatchObject({
      kind: 'malformed-utf8',
    });
  });

  it('rejects a sequence truncated at the end of the entry', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0xc5])))).toMatchObject({
      kind: 'malformed-utf8',
      offset: 14,
      reason: 'multi-byte sequence truncated at the end of the entry',
    });
  });

  it('rejects an invalid continuation byte', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0xc5, 0x41])))).toMatchObject({
      kind: 'malformed-utf8',
      offset: 14,
    });
  });

  it.each([
    [[0xc0, 0x81], 'the 2-byte sequence encodes U+0001'],
    [[0xe0, 0x80, 0x81], 'the 3-byte sequence encodes U+0001'],
    [[0xe0, 0x81, 0x80], 'the 3-byte sequence encodes U+0040'],
    [[0xe0, 0x80, 0x80], 'the 3-byte sequence encodes U+0000'],
  ])('rejects the overlong sequence %j, as a class loader does', (nameBytes, reason) => {
    expect(expectClassFileError(() => parseClassFile(classWithName(nameBytes)))).toMatchObject({
      kind: 'malformed-utf8',
      offset: 13,
      reason: `${reason}, which JVMS §4.4.7 encodes in fewer bytes`,
    });
  });

  it('keeps the two-byte form of U+0000, which is the shortest one it has', () => {
    expect(parseClassFile(classWithName([0xc0, 0x80])).thisClassName).toBe(' ');
  });

  it('accepts a lone surrogate, which a class loader also accepts', () => {
    expect(parseClassFile(classWithName([0xed, 0xa0, 0xbd])).thisClassName).toBe('\ud83d');
  });
});

describe('parseClassFile: robustness property test', () => {
  function parseIsSafe(bytes: Uint8Array): void {
    try {
      parseClassFile(bytes.slice().buffer);
    } catch (error) {
      if (!isClassFileError(error)) {
        throw error;
      }
    }
  }

  it('throws nothing but ClassFileError on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        parseIsSafe(bytes);
      }),
      { numRuns: 500 },
    );
  });

  it('throws nothing but ClassFileError on random bytes with a valid magic', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (tail) => {
        parseIsSafe(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, ...tail]));
      }),
      { numRuns: 500 },
    );
  });

  it('refuses bytes appended after the last class attribute', () => {
    const full = factorialBytes();
    const padded = Uint8Array.from([...full, 0x00, 0x00, 0x00, 0x00]);

    expect(expectClassFileError(() => parseClassFile(padded.buffer))).toMatchObject({
      kind: 'malformed-structure',
      reason: '4 byte(s) after the last class attribute',
    });
    expect(() => parseClassFile(full.buffer)).not.toThrow();
  });

  it('reports every truncated prefix of the fixture as a ClassFileError', () => {
    const full = factorialBytes();

    fc.assert(
      fc.property(fc.integer({ min: 0, max: full.length - 1 }), (length) => {
        const detail = expectClassFileError(() => parseClassFile(full.slice(0, length).buffer));
        expect(detail.kind).toBe('truncated');
      }),
      { numRuns: 200 },
    );
  });
});
