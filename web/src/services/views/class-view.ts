import {
  accessFlagNames,
  CLASS_ACCESS_FLAGS,
  ConstantTag,
  FIELD_ACCESS_FLAGS,
  formatJvmType,
  isClassFileError,
  METHOD_ACCESS_FLAGS,
  parseFieldDescriptor,
  type ClassFile,
  type ConstantPool,
  type FieldInfo,
} from '../../core/classfile';

import { resolveConstant, tagNameOf } from './constant-pool';

export interface ClassFact {
  readonly label: string;
  readonly value: string;
  readonly note?: string | undefined;
}

export function classFactsOf(classFile: ClassFile): readonly ClassFact[] {
  const flags = accessFlagNames(classFile.accessFlags, CLASS_ACCESS_FLAGS);
  const release = javaReleaseOf(classFile.majorVersion);

  return [
    { label: 'this_class', value: classFile.thisClassName },
    {
      label: 'super_class',
      value: classFile.superClassName === '' ? '–' : classFile.superClassName,
    },
    {
      label: 'interfaces',
      value: classFile.interfaceNames.length === 0 ? '–' : classFile.interfaceNames.join(', '),
    },
    {
      label: 'version',
      value: `${String(classFile.majorVersion)}.${String(classFile.minorVersion)}`,
      note: release === undefined ? undefined : `class file format of ${release}`,
    },
    { label: 'access_flags', value: flags.length === 0 ? '–' : flags.join(' ') },
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

export function methodModifiersOf(accessFlags: number): readonly string[] {
  return accessFlagNames(accessFlags, METHOD_ACCESS_FLAGS);
}

export function fieldModifiersOf(accessFlags: number): readonly string[] {
  return accessFlagNames(accessFlags, FIELD_ACCESS_FLAGS);
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
    case ConstantTag.Module:
    case ConstantTag.Package:
      return [entry.nameIndex];
    case ConstantTag.String:
      return [entry.stringIndex];
    case ConstantTag.Fieldref:
    case ConstantTag.Methodref:
    case ConstantTag.InterfaceMethodref:
      return [entry.classIndex, entry.nameAndTypeIndex];
    case ConstantTag.NameAndType:
      return [entry.nameIndex, entry.descriptorIndex];
    case ConstantTag.MethodHandle:
      return [entry.referenceIndex];
    case ConstantTag.MethodType:
      return [entry.descriptorIndex];
    case ConstantTag.Dynamic:
    case ConstantTag.InvokeDynamic:
      return [entry.nameAndTypeIndex];
    case ConstantTag.Utf8:
    case ConstantTag.Integer:
    case ConstantTag.Float:
    case ConstantTag.Long:
    case ConstantTag.Double:
      return NO_REFERENCES;
  }
}

const NO_REFERENCES: readonly number[] = [];
