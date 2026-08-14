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

const TAG_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(ConstantTag).map(([name, tag]) => [tag, name]),
);

export function constantTagName(tag: number): string | undefined {
  return TAG_NAMES.get(tag);
}

export interface Utf8Constant {
  readonly tag: typeof ConstantTag.Utf8;
  readonly value: string;
}

export interface IntegerConstant {
  readonly tag: typeof ConstantTag.Integer;
  readonly value: number;
}

export interface FloatConstant {
  readonly tag: typeof ConstantTag.Float;
  readonly value: number;
}

export interface LongConstant {
  readonly tag: typeof ConstantTag.Long;
  readonly value: bigint;
}

export interface DoubleConstant {
  readonly tag: typeof ConstantTag.Double;
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

export interface InterfaceMethodrefConstant {
  readonly tag: typeof ConstantTag.InterfaceMethodref;
  readonly classIndex: number;
  readonly nameAndTypeIndex: number;
}

export interface NameAndTypeConstant {
  readonly tag: typeof ConstantTag.NameAndType;
  readonly nameIndex: number;
  readonly descriptorIndex: number;
}

export interface MethodHandleConstant {
  readonly tag: typeof ConstantTag.MethodHandle;
  readonly referenceKind: number;
  readonly referenceIndex: number;
}

export interface MethodTypeConstant {
  readonly tag: typeof ConstantTag.MethodType;
  readonly descriptorIndex: number;
}

export interface DynamicConstant {
  readonly tag: typeof ConstantTag.Dynamic;
  readonly bootstrapMethodAttrIndex: number;
  readonly nameAndTypeIndex: number;
}

export interface InvokeDynamicConstant {
  readonly tag: typeof ConstantTag.InvokeDynamic;
  readonly bootstrapMethodAttrIndex: number;
  readonly nameAndTypeIndex: number;
}

export interface ModuleConstant {
  readonly tag: typeof ConstantTag.Module;
  readonly nameIndex: number;
}

export interface PackageConstant {
  readonly tag: typeof ConstantTag.Package;
  readonly nameIndex: number;
}

export type ConstantPoolEntry =
  | Utf8Constant
  | IntegerConstant
  | FloatConstant
  | LongConstant
  | DoubleConstant
  | ClassConstant
  | StringConstant
  | FieldrefConstant
  | MethodrefConstant
  | InterfaceMethodrefConstant
  | NameAndTypeConstant
  | MethodHandleConstant
  | MethodTypeConstant
  | DynamicConstant
  | InvokeDynamicConstant
  | ModuleConstant
  | PackageConstant;

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
  readonly superClassName?: string;
  readonly interfaceNames: readonly string[];
  readonly fields: readonly FieldInfo[];
  readonly methods: readonly MethodInfo[];
}
