import { describe, expect, it } from 'vitest';

import { ConstantTag, parseClassFile, type ConstantPool } from '../core/classfile';
import {
  ConstantPoolBuilder,
  syntheticClass,
} from '../core/interpreter/__fixtures__/synthetic-class';

import { readExampleBytes, readFixtureBytes } from './__fixtures__/example-files';
import {
  classFactsOf,
  constantPoolRowsOf,
  fieldModifiersOf,
  fieldRowsOf,
  javaReleaseOf,
  methodModifiersOf,
} from './class-view';

function factOf(label: string, fileName: string): string {
  const facts = classFactsOf(parseClassFile(readExampleBytes(fileName)));
  const fact = facts.find((candidate) => candidate.label === label);
  if (fact === undefined) {
    throw new Error(`no fact called ${label}`);
  }
  return fact.value;
}

describe('class facts', () => {
  it('reads the class header the way javap opens a dump', () => {
    expect(factOf('this_class', 'Factorial.class')).toBe('Factorial');
    expect(factOf('super_class', 'Factorial.class')).toBe('java/lang/Object');
    expect(factOf('interfaces', 'Factorial.class')).toBe('–');
  });

  it('names the Java release a major version belongs to', () => {
    const facts = classFactsOf(parseClassFile(readFixtureBytes('Library.class')));
    const version = facts.find((fact) => fact.label === 'version');

    expect(version?.value).toBe('65.0');
    expect(version?.note).toBe('class file format of Java 21');
  });

  it('decodes the access flags into the names JVMS gives them', () => {
    expect(factOf('access_flags', 'Factorial.class')).toContain('public');
    const facts = classFactsOf(parseClassFile(readFixtureBytes('Library.class')));
    expect(facts.find((fact) => fact.label === 'access_flags')?.value).toBe('public final super');
  });

  it('says so plainly when a class implements nothing and extends nothing', () => {
    const facts = classFactsOf({
      ...syntheticClass({ methods: [] }),
      superClassName: '',
      accessFlags: 0,
    });

    expect(facts.find((fact) => fact.label === 'super_class')?.value).toBe('–');
    expect(facts.find((fact) => fact.label === 'access_flags')?.value).toBe('–');
  });
});

describe('javaReleaseOf', () => {
  it('follows JVMS table 4.1-A arithmetically rather than by a list', () => {
    expect(javaReleaseOf(45)).toBe('Java 1.1');
    expect(javaReleaseOf(48)).toBe('Java 1.4');
    expect(javaReleaseOf(52)).toBe('Java 8');
    expect(javaReleaseOf(65)).toBe('Java 21');
    expect(javaReleaseOf(69)).toBe('Java 25');
  });

  it('has nothing to say about a version that predates the table', () => {
    expect(javaReleaseOf(44)).toBeUndefined();
  });
});

describe('access flag names', () => {
  it('names the method modifiers of JVMS table 4.6-A', () => {
    expect(methodModifiersOf(0x0009)).toEqual(['public', 'static']);
    expect(methodModifiersOf(0x0402)).toEqual(['private', 'abstract']);
    expect(methodModifiersOf(0)).toEqual([]);
  });

  it('names the field modifiers of JVMS table 4.5-A', () => {
    expect(fieldModifiersOf(0x001a)).toEqual(['private', 'static', 'final']);
    expect(fieldModifiersOf(0x4008)).toEqual(['static', 'enum']);
    expect(fieldModifiersOf(0x0040)).toEqual(['volatile']);
  });

  it('names the bits javac sets that no source keyword spells', () => {
    expect(methodModifiersOf(0x0040)).toEqual(['bridge']);
    expect(methodModifiersOf(0x1080)).toEqual(['varargs', 'synthetic']);
  });
});

describe('field rows', () => {
  it('reads a descriptor as the Java type it stands for', () => {
    const rows = fieldRowsOf(
      syntheticClassWithFields([
        { name: 'size', descriptor: 'I', accessFlags: 0x000a },
        { name: 'data', descriptor: '[I', accessFlags: 0x0002 },
        { name: 'name', descriptor: 'Ljava/lang/String;', accessFlags: 0x0011 },
      ]),
    );

    expect(rows.map((row) => row.type)).toEqual(['int', 'int[]', 'java.lang.String']);
    expect(rows[0]?.modifiers).toEqual(['private', 'static']);
    expect(rows[0]?.descriptor).toBe('I');
  });

  it('leaves a descriptor it cannot read as the text the file holds', () => {
    const rows = fieldRowsOf(
      syntheticClassWithFields([{ name: 'x', descriptor: 'Q', accessFlags: 0 }]),
    );

    expect(rows[0]?.type).toBe('Q');
  });
});

function syntheticClassWithFields(
  fields: readonly { name: string; descriptor: string; accessFlags: number }[],
) {
  return { ...syntheticClass({ methods: [] }), fields };
}

describe('constant pool rows', () => {
  it('resolves an entry down to the strings behind it', () => {
    const rows = constantPoolRowsOf(
      parseClassFile(readExampleBytes('Factorial.class')).constantPool,
    );
    const methodref = rows.find(
      (row) => row.tagName === 'Methodref' && row.text.startsWith('Factorial'),
    );

    expect(methodref?.text).toBe('Factorial.factorial:(I)I');
    expect(methodref?.references).toHaveLength(2);
  });

  it('skips index 0 and the hole after a Long, which are not entries at all', () => {
    const pool: ConstantPool = [
      null,
      { tag: ConstantTag.Long, value: 4_294_967_296n },
      null,
      { tag: ConstantTag.Utf8, value: 'after' },
    ];

    expect(constantPoolRowsOf(pool).map((row) => row.index)).toEqual([1, 3]);
  });

  it('links the entries that were tag-only until the parser read their indices', () => {
    const pool = new ConstantPoolBuilder();
    const listClass = pool.classEntry('java/util/List');
    const add = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: pool.utf8('add'),
      descriptorIndex: pool.utf8('(Ljava/lang/Object;)Z'),
    });
    const interfaceMethod = pool.raw({
      tag: ConstantTag.InterfaceMethodref,
      classIndex: listClass,
      nameAndTypeIndex: add,
    });
    const factory = pool.methodref('java/lang/invoke/StringConcatFactory', 'makeConcat', '()V');
    const handle = pool.raw({
      tag: ConstantTag.MethodHandle,
      referenceKind: 6,
      referenceIndex: factory,
    });
    const descriptor = pool.utf8('(Ljava/lang/Object;)Z');
    const methodType = pool.raw({ tag: ConstantTag.MethodType, descriptorIndex: descriptor });
    const moduleName = pool.utf8('java.base');
    const module = pool.raw({ tag: ConstantTag.Module, nameIndex: moduleName });

    const rows = constantPoolRowsOf(pool.build());
    const referencesAt = (index: number) => rows.find((row) => row.index === index)?.references;

    expect(referencesAt(interfaceMethod)).toEqual([listClass, add]);
    expect(referencesAt(handle)).toEqual([factory]);
    expect(referencesAt(methodType)).toEqual([descriptor]);
    expect(referencesAt(module)).toEqual([moduleName]);
  });

  it('does not treat the bootstrap method index of an invokedynamic as a pool index', () => {
    const pool = new ConstantPoolBuilder();
    const member = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: pool.utf8('makeConcatWithConstants'),
      descriptorIndex: pool.utf8('(I)Ljava/lang/String;'),
    });
    const invokeDynamic = pool.raw({
      tag: ConstantTag.InvokeDynamic,
      bootstrapMethodAttrIndex: 0,
      nameAndTypeIndex: member,
    });

    const row = constantPoolRowsOf(pool.build()).find((entry) => entry.index === invokeDynamic);

    expect(row?.references).toEqual([member]);
    expect(row?.text).toBe('#0:makeConcatWithConstants:(I)Ljava/lang/String;');
  });

  it('keeps a row for an entry whose references do not resolve', () => {
    const pool = new ConstantPoolBuilder();
    const utf8 = pool.utf8('not a class');
    pool.raw({ tag: ConstantTag.Methodref, classIndex: utf8, nameAndTypeIndex: utf8 });

    const rows = constantPoolRowsOf(pool.build());

    expect(rows.at(-1)).toMatchObject({ tagName: 'Methodref', text: 'unresolved' });
  });
});
