import {
  constantTagName,
  ConstantTag,
  isClassFileError,
  parseMethodDescriptor,
  poolEntry as entryAt,
  utf8At,
  type ConstantPool,
  type ConstantPoolEntry,
  type JvmReturnType,
  type MethodDescriptor,
} from '../classfile';
import { VmFault } from './errors';
import type { ValueKind } from './types';

export function describeConstant(entry: ConstantPoolEntry | undefined, index: number): string {
  const named = entry === undefined ? undefined : constantTagName(entry.tag);
  return named === undefined
    ? `constant pool entry #${String(index)}`
    : `the ${named} constant at #${String(index)}`;
}

export function parameterKinds(descriptor: string): readonly ValueKind[] | undefined {
  const parsed = parseDescriptor(descriptor);
  if (parsed === undefined) {
    return undefined;
  }
  const returnable =
    parsed.returnType.kind === 'void' ||
    isIntType(parsed.returnType) ||
    isReferenceType(parsed.returnType);
  if (!returnable || !parsed.params.every((type) => isIntType(type) || isReferenceType(type))) {
    return undefined;
  }
  return parsed.params.map((type) => (isIntType(type) ? 'int' : 'ref'));
}

function isReferenceType(type: JvmReturnType): boolean {
  return type.kind === 'class' || type.kind === 'array';
}

export function classNameAt(pool: ConstantPool, index: number): string {
  const entry = poolEntry(pool, index);
  if (entry?.tag !== ConstantTag.Class) {
    throw badPoolEntry(index, 'Class');
  }
  return utf8(pool, entry.nameIndex);
}

function parseDescriptor(descriptor: string): MethodDescriptor | undefined {
  try {
    return parseMethodDescriptor(descriptor);
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    return undefined;
  }
}

function isIntType(type: JvmReturnType): boolean {
  return type.kind === 'primitive' && type.name === 'int';
}

export interface MethodReference {
  readonly className: string;
  readonly name: string;
  readonly descriptor: string;
}

export function callTarget(reference: MethodReference): string {
  return `${reference.className}.${reference.name}${reference.descriptor}`;
}

export function resolveMethodref(pool: ConstantPool, index: number): MethodReference {
  return resolveMemberReference(pool, index, ConstantTag.Methodref, 'Methodref');
}

export function resolveMemberReference(
  pool: ConstantPool,
  index: number,
  tag: typeof ConstantTag.Methodref | typeof ConstantTag.Fieldref,
  tagName: string,
): MethodReference {
  const reference = poolEntry(pool, index);
  if (reference?.tag !== tag) {
    throw badPoolEntry(index, tagName);
  }
  const owner = poolEntry(pool, reference.classIndex);
  if (owner?.tag !== ConstantTag.Class) {
    throw badPoolEntry(reference.classIndex, 'Class');
  }
  const nameAndType = poolEntry(pool, reference.nameAndTypeIndex);
  if (nameAndType?.tag !== ConstantTag.NameAndType) {
    throw badPoolEntry(reference.nameAndTypeIndex, 'NameAndType');
  }

  return {
    className: utf8(pool, owner.nameIndex),
    name: utf8(pool, nameAndType.nameIndex),
    descriptor: utf8(pool, nameAndType.descriptorIndex),
  };
}

export function poolEntry(pool: ConstantPool, index: number): ConstantPoolEntry | undefined {
  return entryAt(pool, index);
}

export function utf8(pool: ConstantPool, index: number): string {
  return required(utf8At(pool, index), index, 'Utf8');
}

function required<T>(value: T | undefined, index: number, expected: string): T {
  if (value === undefined) {
    throw badPoolEntry(index, expected);
  }
  return value;
}

function badPoolEntry(index: number, expected: string): VmFault {
  return new VmFault({
    kind: 'invalid-state',
    message: `constant pool entry #${String(index)} is not a ${expected}`,
  });
}
