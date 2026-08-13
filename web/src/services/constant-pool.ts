import { constantTagName, ConstantTag, type ClassFile, type ConstantPool } from '../core/classfile';
import { lookupOpcode, type Instruction } from '../core/disassembler';

import type { MethodListing } from './program';

export function constantPoolComments(
  listing: MethodListing,
  classFile: ClassFile,
): ReadonlyMap<number, string> {
  const comments = new Map<number, string>();
  for (const instruction of listing.instructions) {
    const constant = resolveOperandConstant(instruction, classFile.constantPool);
    if (constant !== undefined) {
      comments.set(instruction.offset, constant.comment);
    }
  }
  return comments;
}

export interface ResolvedConstant {
  readonly index: number;
  readonly tagName: string;
  readonly text: string;
  readonly chain: readonly string[];
  readonly comment: string;
}

export function resolveConstant(pool: ConstantPool, index: number): ResolvedConstant | undefined {
  const entry = pool[index] ?? undefined;
  if (entry === undefined) {
    return undefined;
  }

  const tagName = tagNameOf(entry.tag);
  const link = (text: string, comment: string): ResolvedConstant => ({
    index,
    tagName,
    text,
    chain: [`#${String(index)}`, tagName, text],
    comment,
  });

  switch (entry.tag) {
    case ConstantTag.Methodref:
    case ConstantTag.Fieldref:
    case ConstantTag.InterfaceMethodref: {
      const owner = className(pool, entry.classIndex);
      const member = nameAndType(pool, entry.nameAndTypeIndex);
      if (owner === undefined || member === undefined) {
        return undefined;
      }
      const text = `${owner}.${member.name}:${member.descriptor}`;
      return link(text, `// ${MEMBER_KINDS.get(entry.tag) ?? tagName} ${text}`);
    }
    case ConstantTag.Class: {
      const name = utf8(pool, entry.nameIndex);
      return name === undefined ? undefined : link(name, `// class ${name}`);
    }
    case ConstantTag.NameAndType: {
      const member = nameAndType(pool, index);
      return member === undefined
        ? undefined
        : link(`${member.name}:${member.descriptor}`, `// ${member.name}:${member.descriptor}`);
    }
    case ConstantTag.String: {
      const value = utf8(pool, entry.stringIndex);
      return value === undefined ? undefined : link(`"${value}"`, `// String ${value}`);
    }
    case ConstantTag.Integer:
      return link(String(entry.value), `// int ${String(entry.value)}`);
    case ConstantTag.Utf8:
      return link(entry.value, `// ${entry.value}`);
    case ConstantTag.MethodHandle: {
      const kind = REFERENCE_KINDS.get(entry.referenceKind);
      const target = pool[entry.referenceIndex] ?? undefined;
      const referenced =
        target !== undefined && MEMBER_KINDS.has(target.tag)
          ? resolveConstant(pool, entry.referenceIndex)
          : undefined;
      if (kind === undefined || referenced === undefined) {
        return undefined;
      }
      const text = `${kind} ${referenced.text}`;
      return link(text, `// MethodHandle ${text}`);
    }
    case ConstantTag.MethodType: {
      const descriptor = utf8(pool, entry.descriptorIndex);
      return descriptor === undefined ? undefined : link(descriptor, `// MethodType ${descriptor}`);
    }
    case ConstantTag.Dynamic:
    case ConstantTag.InvokeDynamic: {
      const member = nameAndType(pool, entry.nameAndTypeIndex);
      if (member === undefined) {
        return undefined;
      }
      const text = `#${String(entry.bootstrapMethodAttrIndex)}:${member.name}:${member.descriptor}`;
      return link(text, `// ${tagName} ${text}`);
    }
    case ConstantTag.Module:
    case ConstantTag.Package: {
      const name = utf8(pool, entry.nameIndex);
      return name === undefined ? undefined : link(name, `// ${tagName} ${name}`);
    }
    case ConstantTag.Float: {
      const text = `${decimalText(entry.value)}f`;
      return link(text, `// float ${text}`);
    }
    case ConstantTag.Double: {
      const text = `${decimalText(entry.value)}d`;
      return link(text, `// double ${text}`);
    }
    case ConstantTag.Long: {
      const text = `${entry.value.toString()}l`;
      return link(text, `// long ${text}`);
    }
  }
}

function decimalText(value: number): string {
  if (!Number.isInteger(value)) {
    return String(value);
  }
  return Object.is(value, -0) ? '-0.0' : `${String(value)}.0`;
}

const MEMBER_KINDS: ReadonlyMap<number, string> = new Map([
  [ConstantTag.Methodref, 'Method'],
  [ConstantTag.Fieldref, 'Field'],
  [ConstantTag.InterfaceMethodref, 'InterfaceMethod'],
]);

const REFERENCE_KINDS: ReadonlyMap<number, string> = new Map([
  [1, 'REF_getField'],
  [2, 'REF_getStatic'],
  [3, 'REF_putField'],
  [4, 'REF_putStatic'],
  [5, 'REF_invokeVirtual'],
  [6, 'REF_invokeStatic'],
  [7, 'REF_invokeSpecial'],
  [8, 'REF_newInvokeSpecial'],
  [9, 'REF_invokeInterface'],
]);

export function tagNameOf(tag: number): string {
  return constantTagName(tag) ?? `tag ${String(tag)}`;
}

export function constantPoolIndexOf(instruction: Instruction): number | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info === undefined) {
    return undefined;
  }
  const position = info.operands.findIndex((operand) => operand.role === 'constant-pool-index');
  return position < 0 ? undefined : instruction.operands[position];
}

export function resolveOperandConstant(
  instruction: Instruction,
  pool: ConstantPool,
): ResolvedConstant | undefined {
  const index = constantPoolIndexOf(instruction);
  return index === undefined ? undefined : resolveConstant(pool, index);
}

export function className(pool: ConstantPool, index: number): string | undefined {
  const entry = pool[index] ?? undefined;
  return entry?.tag === ConstantTag.Class ? utf8(pool, entry.nameIndex) : undefined;
}

export function nameAndType(
  pool: ConstantPool,
  index: number,
): { readonly name: string; readonly descriptor: string } | undefined {
  const entry = pool[index] ?? undefined;
  if (entry?.tag !== ConstantTag.NameAndType) {
    return undefined;
  }
  const name = utf8(pool, entry.nameIndex);
  const descriptor = utf8(pool, entry.descriptorIndex);
  return name === undefined || descriptor === undefined ? undefined : { name, descriptor };
}

export function utf8(pool: ConstantPool, index: number): string | undefined {
  const entry = pool[index] ?? undefined;
  return entry?.tag === ConstantTag.Utf8 ? entry.value : undefined;
}
