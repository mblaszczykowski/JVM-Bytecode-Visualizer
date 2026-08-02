import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import { isClassFileError } from './errors';
import { parseClassFile } from './parser';
import { ConstantTag, isStatic, type ClassFile, type MethodInfo } from './types';

/**
 * Source of truth for the assertions: `javap -v -p Factorial.class`; the full dump sits
 * next to the fixture in `__fixtures__/Factorial.javap.txt`. The excerpts the tests rely on:
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
 *     #27 = Utf8       Factorial.java     <- last entry, constant_pool_count = 28
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
 *     StackMapTable: number_of_entries = 1   <- attribute unknown to the parser, must be skipped
 */
const FACTORIAL_CLASS = new URL('./__fixtures__/Factorial.class', import.meta.url);

function factorialBytes(): Uint8Array<ArrayBuffer> {
  // Copy into a fresh buffer: a Node Buffer can be a view onto a shared memory pool.
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

describe('parseClassFile — Factorial.class fixture header', () => {
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
    // ACC_PUBLIC | ACC_SUPER = 0x0021 (javap: "flags: (0x0021)").
    expect(classFile.accessFlags).toBe(0x0021);
  });
});

describe('parseClassFile — fixture constant pool', () => {
  it('is 1-indexed and holds constant_pool_count entries (slot 0 empty)', () => {
    const { constantPool } = parseFactorial();

    expect(constantPool).toHaveLength(28);
    expect(constantPool[0]).toBeNull();
    expect(constantPool[27]).toEqual({ tag: ConstantTag.Utf8, value: 'Factorial.java' });
  });

  it('interprets the tags the MVP requires', () => {
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

describe('parseClassFile — fixture methods', () => {
  it('sees all three methods, including the generated <init>', () => {
    const methods = parseFactorial().methods;

    expect(methods.map((method) => [method.name, method.descriptor])).toEqual([
      ['<init>', '()V'],
      ['main', '([Ljava/lang/String;)V'],
      ['factorial', '(I)I'],
    ]);
  });

  it('reads method access flags', () => {
    // javap: main → (0x0009) ACC_PUBLIC, ACC_STATIC; factorial → (0x0008) ACC_STATIC.
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
    // iload_0, iconst_1, if_icmpgt +5 (the branch delta is relative to the opcode offset).
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
    // If skipping by attribute_length were broken, the parser would already desynchronise
    // on the StackMapTable of factorial and never reach the class attributes.
    const classFile = parseFactorial();

    expect(classFile.methods).toHaveLength(3);
    expect(methodOf('factorial').code?.localVariableTable).toHaveLength(1);
  });
});

// --- Synthetic .class files for the cases the fixture does not cover ---

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
  /** Given explicitly — must account for the double slots of Long/Double (JVMS §4.4.5). */
  readonly constantPoolCount: number;
  readonly thisClass: number;
  readonly superClass: number;
  /** Indices of Class entries in the constant pool. */
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

describe('parseClassFile — Long/Double entries and uninterpreted tags', () => {
  /**
   * A pool holding every tag the MVP does not interpret but must be able to skip.
   * Long (#1) and Double (#3) take two slots each — hence the numbering.
   */
  const kitchenSink = buildClassFile({
    constantPoolCount: 24,
    constantPool: [
      filler(ConstantTag.Long, 8), // #1 (#2 = empty slot)
      filler(ConstantTag.Double, 8), // #3 (#4 = empty slot)
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

  it('leaves an empty slot after Long and Double without shifting later indices', () => {
    const { constantPool } = parseClassFile(kitchenSink);

    expect(constantPool).toHaveLength(24);
    expect(constantPool[1]).toEqual({ tag: ConstantTag.Long });
    expect(constantPool[2]).toBeNull();
    expect(constantPool[3]).toEqual({ tag: ConstantTag.Double });
    expect(constantPool[4]).toBeNull();
    expect(constantPool[5]).toEqual({ tag: ConstantTag.Float });
  });

  it('skips tags of known length and lands on the following entries', () => {
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

describe('parseClassFile — skipping unknown attributes at every level', () => {
  const BOGUS = 12;
  const codeBody = [
    ...u2(2), // max_stack
    ...u2(1), // max_locals
    ...u4(2), // code_length
    0x03,
    0xb1, // iconst_0, return
    ...u2(1), // exception_table_length — read and ignored
    ...u2(0),
    ...u2(2),
    ...u2(0),
    ...u2(0),
    ...u2(3), // attributes_count inside Code
    ...attribute(BOGUS, [0xff]),
    ...attribute(10, [...u2(1), ...u2(0), ...u2(7)]), // LineNumberTable: pc 0 → line 7
    ...attribute(11, [...u2(1), ...u2(0), ...u2(2), ...u2(13), ...u2(6), ...u2(0)]), // LocalVariableTable: x/I in slot 0
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

describe('parseClassFile — methods without Code and Code without debug tables', () => {
  const buffer = buildClassFile({
    constantPoolCount: 7,
    constantPool: [
      utf8Entry('Synth'), // #1
      classEntry(1), // #2
      utf8Entry('abstractMethod'), // #3
      utf8Entry('()V'), // #4
      utf8Entry('Code'), // #5
      utf8Entry('noDebugInfo'), // #6
    ],
    thisClass: 2,
    superClass: 0,
    methods: [
      // ACC_ABSTRACT — JVMS §4.6 forbids such a method from having a Code attribute.
      member(0x0400, 3, 4, []),
      // Code without LineNumberTable/LocalVariableTable, i.e. a class compiled without -g.
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
    // A method with no `try` in it has no rows, and carries no empty array either.
    expect(method?.code?.exceptionTable).toBeUndefined();
  });
});

describe('parseClassFile — the exception table (JVMS §4.7.3)', () => {
  const ARITHMETIC = 'java/lang/ArithmeticException';

  /** Two handlers over the same one-byte method: one typed, one the catch-all `finally` row. */
  const buffer = buildClassFile({
    constantPoolCount: 8,
    constantPool: [
      utf8Entry('Synth'), // #1
      classEntry(1), // #2
      utf8Entry('guarded'), // #3
      utf8Entry('()V'), // #4
      utf8Entry('Code'), // #5
      utf8Entry(ARITHMETIC), // #6
      classEntry(6), // #7
    ],
    thisClass: 2,
    superClass: 0,
    methods: [
      member(0x0008, 3, 4, [
        attribute(5, [
          ...u2(1), // max_stack
          ...u2(1), // max_locals
          ...u4(1), // code_length
          0xb1, // return
          ...u2(2), // exception_table_length
          ...u2(0), // [0].start_pc
          ...u2(1), // [0].end_pc
          ...u2(1), // [0].handler_pc
          ...u2(7), // [0].catch_type -> Class #7
          ...u2(0), // [1].start_pc
          ...u2(1), // [1].end_pc
          ...u2(1), // [1].handler_pc
          ...u2(0), // [1].catch_type = 0, catches everything
          ...u2(0), // attributes_count
        ]),
      ]),
    ],
  });

  it('reads every row and resolves the class each one catches', () => {
    expect(parseClassFile(buffer).methods[0]?.code?.exceptionTable).toEqual([
      { startPc: 0, endPc: 1, handlerPc: 1, catchTypeIndex: 7, catchType: ARITHMETIC },
      { startPc: 0, endPc: 1, handlerPc: 1, catchTypeIndex: 0 },
    ]);
  });

  it('leaves catchType off the catch-all row rather than inventing a class for it', () => {
    const rows = parseClassFile(buffer).methods[0]?.code?.exceptionTable ?? [];

    expect(rows[1] && 'catchType' in rows[1]).toBe(false);
  });

  it('keeps the rows in the order the class file wrote them', () => {
    // The order is the order of the `catch` clauses, and the first match wins — so a parser
    // that sorted or deduplicated them would change which handler runs.
    const rows = parseClassFile(buffer).methods[0]?.code?.exceptionTable ?? [];

    expect(rows.map((row) => row.catchTypeIndex)).toEqual([7, 0]);
  });
});

describe('parseClassFile — interfaces', () => {
  it('resolves the names of implemented interfaces', () => {
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

describe('parseClassFile — errors', () => {
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
    // 12 bytes = header (10 B) + the tag of entry #1 (Methodref) + one byte of class_index.
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
      constantPool: [[2]], // tag 2 does not exist in JVMS §4.4
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
      thisClass: 2, // the second slot of the Long entry — empty
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

  it('reports malformed-utf8 on an invalid byte sequence', () => {
    const buffer = buildClassFile({
      constantPoolCount: 2,
      constantPool: [[ConstantTag.Utf8, ...u2(2), 0xf0, 0x9f]], // the 4-byte form is forbidden
      thisClass: 1,
      superClass: 0,
    });

    expect(expectClassFileError(() => parseClassFile(buffer))).toMatchObject({
      kind: 'malformed-utf8',
      constantPoolIndex: 1,
    });
  });
});

describe('parseClassFile — modified UTF-8 decoding (JVMS §4.4.7)', () => {
  function classWithName(nameBytes: readonly number[]): ArrayBuffer {
    return buildClassFile({
      constantPoolCount: 3,
      constantPool: [[ConstantTag.Utf8, ...u2(nameBytes.length), ...nameBytes], classEntry(1)],
      thisClass: 2,
      superClass: 0,
    });
  }

  it('decodes two- and three-byte sequences', () => {
    // 0xC0 0x80 = U+0000, 0xC5 0xBC = U+017C, 0xE2 0x82 0xAC = U+20AC (euro sign)
    const buffer = classWithName([0x41, 0xc0, 0x80, 0xc5, 0xbc, 0xe2, 0x82, 0xac]);

    expect(parseClassFile(buffer).thisClassName).toBe('A\u0000\u017c\u20ac');
  });

  it('decodes supplementary characters written as a surrogate pair (six-byte form)', () => {
    // U+1F600 = surrogates D83D DE00 → 0xED 0xA0 0xBD 0xED 0xB8 0x80
    const buffer = classWithName([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);

    expect(parseClassFile(buffer).thisClassName).toBe('\u{1f600}');
  });

  it('rejects a bare 0x00 byte (U+0000 must be encoded as 0xC0 0x80)', () => {
    expect(expectClassFileError(() => parseClassFile(classWithName([0x41, 0x00])))).toMatchObject({
      kind: 'malformed-utf8',
    });
  });

  it('rejects a sequence truncated at the end of the entry', () => {
    // 0xC5 announces two bytes, but the entry ends after the first one.
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
});

describe('parseClassFile — robustness property test', () => {
  function parseIsSafe(bytes: Uint8Array): void {
    try {
      // slice() yields a copy in its own ArrayBuffer — fast-check returns shared views.
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

  it('every truncated fixture ends in a ClassFileError, never a runtime exception', () => {
    const full = factorialBytes();

    fc.assert(
      fc.property(fc.integer({ min: 0, max: full.length - 1 }), (length) => {
        // Every truncation removes bytes of some structure — a valid file ends exactly on
        // the last class attribute, so every prefix must be reported as truncated.
        const detail = expectClassFileError(() => parseClassFile(full.slice(0, length).buffer));
        expect(detail.kind).toBe('truncated');
      }),
      { numRuns: 200 },
    );
  });
});
