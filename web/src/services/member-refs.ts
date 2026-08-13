import {
  ConstantTag,
  isClassFileError,
  parseMethodDescriptor,
  type ConstantPool,
  type JvmReturnType,
} from '../core/classfile';
import type { Instruction } from '../core/disassembler';

import { className, constantPoolIndexOf, nameAndType } from './constant-pool';

export interface Callee {
  readonly name: string;
  readonly descriptor: string;
  readonly arity: number;
  readonly parameterSlots: number;
  readonly returnSlots: number;
  readonly returnsReference: boolean;
}

export function calleeOf(instruction: Instruction, pool: ConstantPool): Callee | undefined {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);
  if (entry?.tag !== ConstantTag.Methodref) {
    return undefined;
  }
  const member = nameAndType(pool, entry.nameAndTypeIndex);
  if (member === undefined) {
    return undefined;
  }

  const parsed = parseDescriptor(member.descriptor);
  if (parsed === undefined) {
    return undefined;
  }
  return { name: member.name, descriptor: member.descriptor, ...parsed };
}

export interface Member {
  readonly owner: string;
  readonly name: string;
  readonly descriptor: string;
}

export function memberOf(instruction: Instruction, pool: ConstantPool): Member | undefined {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);
  if (entry?.tag !== ConstantTag.Fieldref && entry?.tag !== ConstantTag.Methodref) {
    return undefined;
  }
  const owner = className(pool, entry.classIndex);
  const member = nameAndType(pool, entry.nameAndTypeIndex);
  return owner === undefined || member === undefined
    ? undefined
    : { owner, name: member.name, descriptor: member.descriptor };
}

export function ownerOf(instruction: Instruction, pool: ConstantPool): string | undefined {
  return memberOf(instruction, pool)?.owner;
}

export function parseDescriptor(descriptor: string):
  | {
      readonly arity: number;
      readonly parameterSlots: number;
      readonly returnSlots: number;
      readonly returnsReference: boolean;
    }
  | undefined {
  try {
    const parsed = parseMethodDescriptor(descriptor);
    return {
      arity: parsed.params.length,
      parameterSlots: parsed.params.reduce((total, type) => total + slotsOf(type), 0),
      returnSlots: slotsOf(parsed.returnType),
      returnsReference: parsed.returnType.kind === 'class' || parsed.returnType.kind === 'array',
    };
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    return undefined;
  }
}

export function slotsOf(type: JvmReturnType): number {
  if (type.kind === 'void') {
    return 0;
  }
  return type.kind === 'primitive' && (type.name === 'long' || type.name === 'double') ? 2 : 1;
}
