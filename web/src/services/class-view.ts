/**
 * The class file as something to read rather than to run: the header `javap -v` opens with,
 * the field table, and the constant pool resolved entry by entry.
 *
 * All of it comes straight out of the parse, so it is available for any `.class` that got past
 * `parseClassFile` — including the ones with no method this interpreter can enter.
 *
 * The access flag tables are kept here rather than in `core/classfile`, which carries only the
 * subset the interpreter branches on (`AccessFlag`). Naming every bit is a display concern.
 */

import {
  ConstantTag,
  formatJvmType,
  isClassFileError,
  parseFieldDescriptor,
  type ClassFile,
  type ConstantPool,
  type FieldInfo,
} from '../core/classfile';

import { resolveConstant, tagNameOf } from './derivations';

export interface ClassFact {
  readonly label: string;
  readonly value: string;
  /** Long-form note under the value, e.g. what a major version means. */
  readonly note?: string | undefined;
}

/**
 * The five things a class file says about itself before any code: who it is, what it extends
 * and implements, which release of the format it is written in, and how it is declared.
 */
export function classFactsOf(classFile: ClassFile): readonly ClassFact[] {
  const flags = flagNames(classFile.accessFlags, CLASS_FLAGS);
  const release = javaReleaseOf(classFile.majorVersion);

  return [
    { label: 'this_class', value: classFile.thisClassName },
    // Only `java/lang/Object` has none, and it is the one class that cannot be run here.
    {
      label: 'super_class',
      value: classFile.superClassName === '' ? '—' : classFile.superClassName,
    },
    {
      label: 'interfaces',
      value: classFile.interfaceNames.length === 0 ? '—' : classFile.interfaceNames.join(', '),
    },
    {
      label: 'version',
      value: `${String(classFile.majorVersion)}.${String(classFile.minorVersion)}`,
      note: release === undefined ? undefined : `class file format of ${release}`,
    },
    { label: 'access_flags', value: flags.length === 0 ? '—' : flags.join(' ') },
  ];
}

/**
 * Java release a major version belongs to (JVMS §4.1, table 4.1-A). 45 is 1.1 and every
 * release since 5 has added exactly one, so the table is arithmetic rather than a list —
 * major 69 is Java 25 without anyone having to add a row for it.
 */
export function javaReleaseOf(majorVersion: number): string | undefined {
  if (majorVersion < 45) {
    return undefined;
  }
  return majorVersion <= 48
    ? `Java 1.${String(majorVersion - 44)}`
    : `Java ${String(majorVersion - 44)}`;
}

/** JVMS §4.1, table 4.1-B. `ACC_SUPER` has no Java keyword; it is named as the flag it is. */
const CLASS_FLAGS: readonly (readonly [number, string])[] = [
  [0x0001, 'public'],
  [0x0010, 'final'],
  [0x0020, 'super'],
  [0x0200, 'interface'],
  [0x0400, 'abstract'],
  [0x1000, 'synthetic'],
  [0x2000, 'annotation'],
  [0x4000, 'enum'],
  [0x8000, 'module'],
];

/** JVMS §4.6, table 4.6-A. */
const METHOD_FLAGS: readonly (readonly [number, string])[] = [
  [0x0001, 'public'],
  [0x0002, 'private'],
  [0x0004, 'protected'],
  [0x0008, 'static'],
  [0x0010, 'final'],
  [0x0020, 'synchronized'],
  [0x0040, 'bridge'],
  [0x0080, 'varargs'],
  [0x0100, 'native'],
  [0x0400, 'abstract'],
  [0x0800, 'strict'],
  [0x1000, 'synthetic'],
];

/** JVMS §4.5, table 4.5-A. */
const FIELD_FLAGS: readonly (readonly [number, string])[] = [
  [0x0001, 'public'],
  [0x0002, 'private'],
  [0x0004, 'protected'],
  [0x0008, 'static'],
  [0x0010, 'final'],
  [0x0040, 'volatile'],
  [0x0080, 'transient'],
  [0x1000, 'synthetic'],
  [0x4000, 'enum'],
];

function flagNames(
  accessFlags: number,
  table: readonly (readonly [number, string])[],
): readonly string[] {
  return table.filter(([bit]) => (accessFlags & bit) !== 0).map(([, name]) => name);
}

export function methodModifiersOf(accessFlags: number): readonly string[] {
  return flagNames(accessFlags, METHOD_FLAGS);
}

export function fieldModifiersOf(accessFlags: number): readonly string[] {
  return flagNames(accessFlags, FIELD_FLAGS);
}

export interface FieldRow {
  readonly name: string;
  readonly descriptor: string;
  /** The descriptor read as a Java type, e.g. `int[]` for `[I`. */
  readonly type: string;
  readonly modifiers: readonly string[];
}

export function fieldRowsOf(classFile: ClassFile): readonly FieldRow[] {
  return classFile.fields.map((field) => ({
    name: field.name,
    descriptor: field.descriptor,
    type: fieldTypeOf(field),
    modifiers: fieldModifiersOf(field.accessFlags),
  }));
}

/** A descriptor the parser accepted but this reader cannot name stays as its raw text. */
function fieldTypeOf(field: FieldInfo): string {
  try {
    return formatJvmType(parseFieldDescriptor(field.descriptor));
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    return field.descriptor;
  }
}

export interface ConstantPoolRow {
  readonly index: number;
  /** Tag name, e.g. `Methodref`. */
  readonly tagName: string;
  /** Fully resolved text, e.g. `Factorial.factorial:(I)I`. */
  readonly text: string;
  /** Indices this entry points at, so a row can be followed to the entries behind it. */
  readonly references: readonly number[];
}

/**
 * Every occupied slot of the pool, in index order. Index 0 is unused and the slot after a
 * `Long`/`Double` is a hole (JVMS §4.4.5) — both are simply absent from the table rather than
 * rendered as empty rows.
 */
export function constantPoolRowsOf(pool: ConstantPool): readonly ConstantPoolRow[] {
  const rows: ConstantPoolRow[] = [];

  for (let index = 1; index < pool.length; index++) {
    const entry = pool[index] ?? undefined;
    if (entry === undefined) {
      continue;
    }
    const resolved = resolveConstant(pool, index);
    rows.push({
      index,
      // An entry that cannot be followed to its strings still has a kind worth naming, so the
      // tag comes from the tag table rather than from the resolution.
      tagName: tagNameOf(entry.tag),
      // A pool the parser accepted can still fail to resolve — a Methodref whose class index
      // points at a Utf8, say. The row exists either way; only its text gives up.
      text: resolved?.text ?? 'unresolved',
      references: referencesOf(entry),
    });
  }

  return rows;
}

/**
 * The indices one entry names, in the order JVMS §4.4 lists them. Everything else — the
 * literal values and the tags the parser reads without interpreting — points nowhere.
 */
function referencesOf(entry: NonNullable<ConstantPool[number]>): readonly number[] {
  switch (entry.tag) {
    case ConstantTag.Class:
      return [entry.nameIndex];
    case ConstantTag.String:
      return [entry.stringIndex];
    case ConstantTag.Fieldref:
    case ConstantTag.Methodref:
      return [entry.classIndex, entry.nameAndTypeIndex];
    case ConstantTag.NameAndType:
      return [entry.nameIndex, entry.descriptorIndex];
    case ConstantTag.Utf8:
    case ConstantTag.Integer:
    case ConstantTag.Float:
    case ConstantTag.Long:
    case ConstantTag.Double:
    case ConstantTag.InterfaceMethodref:
    case ConstantTag.MethodHandle:
    case ConstantTag.MethodType:
    case ConstantTag.Dynamic:
    case ConstantTag.InvokeDynamic:
    case ConstantTag.Module:
    case ConstantTag.Package:
      return NO_REFERENCES;
  }
}

const NO_REFERENCES: readonly number[] = [];
