export const ConstantTag = {
  Utf8: 1,
  Integer: 3,
  Float: 4,
  Long: 5,
  Double: 6,
  Class: 7,
  String: 8,
  Fieldref: 9,
  Methodref: 10,
  InterfaceMethodref: 11,
  NameAndType: 12,
  MethodHandle: 15,
  MethodType: 16,
  Dynamic: 17,
  InvokeDynamic: 18,
  Module: 19,
  Package: 20,
} as const;

export type ConstantTag = (typeof ConstantTag)[keyof typeof ConstantTag];

export type UninterpretedConstantTag =
  | typeof ConstantTag.Float
  | typeof ConstantTag.Long
  | typeof ConstantTag.Double
  | typeof ConstantTag.InterfaceMethodref
  | typeof ConstantTag.MethodHandle
  | typeof ConstantTag.MethodType
  | typeof ConstantTag.Dynamic
  | typeof ConstantTag.InvokeDynamic
  | typeof ConstantTag.Module
  | typeof ConstantTag.Package;

export interface Utf8Constant {
  readonly tag: typeof ConstantTag.Utf8;
  readonly value: string;
}

export interface IntegerConstant {
  readonly tag: typeof ConstantTag.Integer;
  readonly value: number;
}

export interface ClassConstant {
  readonly tag: typeof ConstantTag.Class;
  readonly nameIndex: number;
}

export interface StringConstant {
  readonly tag: typeof ConstantTag.String;
  readonly stringIndex: number;
}

export interface FieldrefConstant {
  readonly tag: typeof ConstantTag.Fieldref;
  readonly classIndex: number;
  readonly nameAndTypeIndex: number;
}

export interface MethodrefConstant {
  readonly tag: typeof ConstantTag.Methodref;
  readonly classIndex: number;
  readonly nameAndTypeIndex: number;
}

export interface NameAndTypeConstant {
  readonly tag: typeof ConstantTag.NameAndType;
  readonly nameIndex: number;
  readonly descriptorIndex: number;
}

export interface UninterpretedConstant {
  readonly tag: UninterpretedConstantTag;
}

export type ConstantPoolEntry =
  | Utf8Constant
  | IntegerConstant
  | ClassConstant
  | StringConstant
  | FieldrefConstant
  | MethodrefConstant
  | NameAndTypeConstant
  | UninterpretedConstant;

export type ConstantPool = readonly (ConstantPoolEntry | null)[];

export interface LineNumberEntry {
  readonly startPc: number;
  readonly lineNumber: number;
}

export interface LocalVariableEntry {
  readonly startPc: number;
  readonly length: number;
  readonly name: string;
  readonly descriptor: string;
  readonly index: number;
}

export interface ExceptionTableEntry {
  readonly startPc: number;
  readonly endPc: number;
  readonly handlerPc: number;
  readonly catchTypeIndex: number;
  readonly catchType?: string;
}

export interface CodeAttribute {
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly code: Uint8Array;
  readonly lineNumberTable?: readonly LineNumberEntry[];
  readonly localVariableTable?: readonly LocalVariableEntry[];
  readonly exceptionTable?: readonly ExceptionTableEntry[];
}

export interface FieldInfo {
  readonly name: string;
  readonly descriptor: string;
  readonly accessFlags: number;
}

export interface MethodInfo {
  readonly name: string;
  readonly descriptor: string;
  readonly accessFlags: number;
  readonly code?: CodeAttribute;
}

export interface ClassFile {
  readonly minorVersion: number;
  readonly majorVersion: number;
  readonly constantPool: ConstantPool;
  readonly accessFlags: number;
  readonly thisClassName: string;
  readonly superClassName: string;
  readonly interfaceNames: readonly string[];
  readonly fields: readonly FieldInfo[];
  readonly methods: readonly MethodInfo[];
}

export const AccessFlag = {
  Public: 0x0001,
  Private: 0x0002,
  Protected: 0x0004,
  Static: 0x0008,
  Final: 0x0010,
  Synchronized: 0x0020,
  Native: 0x0100,
  Abstract: 0x0400,
} as const;

export function isStatic(accessFlags: number): boolean {
  return (accessFlags & AccessFlag.Static) !== 0;
}
