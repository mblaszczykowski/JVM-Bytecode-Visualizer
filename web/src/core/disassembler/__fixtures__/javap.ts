/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { ConstantTag, type ClassFile, type ConstantPool } from '../../classfile';
import { lookupOpcode } from '../opcodes';
import type { Instruction } from '../types';

export interface JavapSwitchCase {
  readonly match: number | undefined;
  readonly target: number;
}

export interface JavapInstruction {
  readonly offset: number;
  readonly mnemonic: string;
  readonly operandText: string;
  readonly comment: string;
  readonly switchCases: readonly JavapSwitchCase[];
}

export interface JavapMethod {
  readonly signature: string;
  readonly instructions: readonly JavapInstruction[];
}

const INSTRUCTION = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/;
const METHOD_HEADER = /^\s{2}(\S.*);\s*$/;
const SWITCH_CASE = /^\s*(-?\d+|default):\s*(\d+)\s*$/;

interface MutableInstruction {
  offset: number;
  mnemonic: string;
  operandText: string;
  comment: string;
  switchCases: JavapSwitchCase[];
}

function parseJavap(dump: string): readonly JavapMethod[] {
  const methods: { signature: string; instructions: MutableInstruction[] }[] = [];
  let openSwitch: MutableInstruction | undefined;

  for (const line of dump.split('\n')) {
    if (openSwitch !== undefined) {
      const arm = SWITCH_CASE.exec(line);
      if (arm !== null) {
        openSwitch.switchCases.push({
          match: arm[1] === 'default' ? undefined : Number(arm[1]),
          target: Number(arm[2]),
        });
        continue;
      }
      if (line.includes('}')) {
        openSwitch = undefined;
        continue;
      }
    }

    const instruction = INSTRUCTION.exec(line);
    if (instruction !== null) {
      const current = methods.at(-1);
      if (current === undefined) {
        throw new Error(`javap dump has an instruction before any method: "${line.trim()}"`);
      }
      const rest = instruction[3] ?? '';
      const commentAt = rest.indexOf('//');
      const decoded: MutableInstruction = {
        offset: Number(instruction[1]),
        mnemonic: instruction[2] ?? '',
        operandText: (commentAt === -1 ? rest : rest.slice(0, commentAt)).trim(),
        comment: commentAt === -1 ? '' : rest.slice(commentAt + 2).trim(),
        switchCases: [],
      };
      current.instructions.push(decoded);
      if (decoded.operandText.startsWith('{')) {
        decoded.operandText = '';
        openSwitch = decoded;
      }
      continue;
    }

    const header = METHOD_HEADER.exec(line);
    if (header !== null) {
      methods.push({ signature: (header[1] ?? '').trim(), instructions: [] });
    }
  }

  return methods;
}

export function readJavap(dump: URL): readonly JavapMethod[] {
  return parseJavap(readFileSync(dump, 'utf8'));
}

export function javapConstantComment(
  classFile: ClassFile,
  instruction: Instruction,
): string | undefined {
  const index = constantPoolIndexOf(instruction);
  const pool = classFile.constantPool;
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);

  switch (entry?.tag) {
    case ConstantTag.Methodref:
      return `Method ${memberText(classFile, entry.classIndex, entry.nameAndTypeIndex)}`;
    case ConstantTag.Fieldref:
      return `Field ${memberText(classFile, entry.classIndex, entry.nameAndTypeIndex)}`;
    case ConstantTag.InterfaceMethodref:
      return `InterfaceMethod ${memberText(classFile, entry.classIndex, entry.nameAndTypeIndex)}`;
    case ConstantTag.Class:
      return `class ${javapName(utf8At(pool, entry.nameIndex))}`;
    case ConstantTag.String:
      return `String ${utf8At(pool, entry.stringIndex)}`;
    case ConstantTag.Integer:
      return `int ${String(entry.value)}`;
    case ConstantTag.Long:
      return `long ${String(entry.value)}l`;
    case ConstantTag.Float:
      return `float ${javaFloat(entry.value)}f`;
    case ConstantTag.Double:
      return `double ${javaDecimal(String(entry.value))}d`;
    case ConstantTag.InvokeDynamic:
      return `InvokeDynamic #${String(entry.bootstrapMethodAttrIndex)}:${memberText(classFile, undefined, entry.nameAndTypeIndex)}`;
    case ConstantTag.Utf8:
    case ConstantTag.NameAndType:
    case ConstantTag.MethodHandle:
    case ConstantTag.MethodType:
    case ConstantTag.Dynamic:
    case ConstantTag.Module:
    case ConstantTag.Package:
    case undefined:
      return undefined;
  }
}

function constantPoolIndexOf(instruction: Instruction): number | undefined {
  const specs = lookupOpcode(instruction.opcode)?.operands ?? [];
  const position = specs.findIndex((spec) => spec.role === 'constant-pool-index');
  return position === -1 ? undefined : instruction.operands[position];
}

function memberText(
  classFile: ClassFile,
  classIndex: number | undefined,
  nameAndTypeIndex: number,
): string {
  const pool = classFile.constantPool;
  const entry = pool[nameAndTypeIndex] ?? undefined;
  if (entry?.tag !== ConstantTag.NameAndType) {
    throw new Error(`constant pool entry #${String(nameAndTypeIndex)} is not a NameAndType`);
  }

  const member = `${javapName(utf8At(pool, entry.nameIndex))}:${utf8At(pool, entry.descriptorIndex)}`;
  const owner = classIndex === undefined ? undefined : classNameAt(pool, classIndex);
  return owner === undefined || owner === classFile.thisClassName ? member : `${owner}.${member}`;
}

function classNameAt(pool: ConstantPool, index: number): string {
  const entry = pool[index] ?? undefined;
  if (entry?.tag !== ConstantTag.Class) {
    throw new Error(`constant pool entry #${String(index)} is not a Class`);
  }
  return utf8At(pool, entry.nameIndex);
}

function utf8At(pool: ConstantPool, index: number): string {
  const entry = pool[index] ?? undefined;
  if (entry?.tag !== ConstantTag.Utf8) {
    throw new Error(`constant pool entry #${String(index)} is not a Utf8`);
  }
  return entry.value;
}

function javaFloat(value: number): string {
  for (let digits = 1; digits < 9; digits += 1) {
    const shortened = Number(value.toPrecision(digits));
    if (Math.fround(shortened) === value) {
      return javaDecimal(String(shortened));
    }
  }
  return javaDecimal(String(value));
}

function javaDecimal(text: string): string {
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

const UNQUOTED_NAME = /^[A-Za-z_$][\w$]*(?:\/[A-Za-z_$][\w$]*)*$/;

function javapName(name: string): string {
  return UNQUOTED_NAME.test(name) ? name : `"${name}"`;
}

export function javapMethod(methods: readonly JavapMethod[], signature: string): JavapMethod {
  const method = methods.find((candidate) => candidate.signature === signature);
  if (method === undefined) {
    const known = methods.map((candidate) => candidate.signature).join(', ');
    throw new Error(`javap dump has no method "${signature}" (it has: ${known})`);
  }
  return method;
}
