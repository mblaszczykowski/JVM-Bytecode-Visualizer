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
  readonly note?: string | undefined;
}

export function classFactsOf(classFile: ClassFile): readonly ClassFact[] {
  const flags = flagNames(classFile.accessFlags, CLASS_FLAGS);
  const release = javaReleaseOf(classFile.majorVersion);

  return [
    { label: 'this_class', value: classFile.thisClassName },
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

export function javaReleaseOf(majorVersion: number): string | undefined {
  if (majorVersion < 45) {
    return undefined;
  }
  return majorVersion <= 48
    ? `Java 1.${String(majorVersion - 44)}`
    : `Java ${String(majorVersion - 44)}`;
}

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
  readonly tagName: string;
  readonly text: string;
  readonly references: readonly number[];
}

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
      tagName: tagNameOf(entry.tag),
      text: resolved?.text ?? 'unresolved',
      references: referencesOf(entry),
    });
  }

  return rows;
}

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
