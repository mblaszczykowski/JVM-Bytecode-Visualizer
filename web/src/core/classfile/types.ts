/**
 * Model of the `.class` parser result.
 *
 * Everything is `readonly`: the parser returns data that the disassembler and interpreter
 * only read from.
 */

/** Constant pool entry tags — JVMS §4.4, table 4.4-B. */
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

/** Tags read only so the parser can correctly advance past them. */
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
  /** Decoded modified UTF-8 (JVMS §4.4.7). */
  readonly value: string;
}

export interface IntegerConstant {
  readonly tag: typeof ConstantTag.Integer;
  /** Signed value (int32) — JVMS §4.4.4. */
  readonly value: number;
}

export interface ClassConstant {
  readonly tag: typeof ConstantTag.Class;
  /** Index of the Utf8 entry holding the internal name, e.g. `java/lang/Object`. */
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

/**
 * An entry of known length whose contents the MVP does not need. Only the tag is kept, so
 * that pool indices stay correct and the UI can still show the entry kind.
 */
export interface UninterpretedConstant {
  readonly tag: UninterpretedConstantTag;
}

/** Union discriminated by `tag` (JVMS §4.4). */
export type ConstantPoolEntry =
  | Utf8Constant
  | IntegerConstant
  | ClassConstant
  | StringConstant
  | FieldrefConstant
  | MethodrefConstant
  | NameAndTypeConstant
  | UninterpretedConstant;

/**
 * A 1-indexed pool: `[0]` is always `null`, and so is the second slot of every
 * `Long`/`Double` entry (JVMS §4.4.5).
 */
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
  /** Slot number in the frame's local variable array. */
  readonly index: number;
}

export interface CodeAttribute {
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly code: Uint8Array;
  /** Present when the class was compiled with line information (javac emits it by default). */
  readonly lineNumberTable?: readonly LineNumberEntry[];
  /** Present only with `javac -g` — without it the UI has no local variable names. */
  readonly localVariableTable?: readonly LocalVariableEntry[];
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
  /** Absent for `abstract`/`native` methods (JVMS §4.6). */
  readonly code?: CodeAttribute;
}

export interface ClassFile {
  readonly minorVersion: number;
  /** 65 = Java 21 (JVMS §4.1, table 4.1-A). */
  readonly majorVersion: number;
  readonly constantPool: ConstantPool;
  readonly accessFlags: number;
  /** Internal name, e.g. `Factorial` — resolved from the constant pool. */
  readonly thisClassName: string;
  /** Empty only for `java/lang/Object`, the sole class without a superclass (JVMS §4.1). */
  readonly superClassName: string;
  readonly interfaceNames: readonly string[];
  readonly fields: readonly FieldInfo[];
  readonly methods: readonly MethodInfo[];
}

/** Subset of the access flags from JVMS §4.6, table 4.6-A, used by the interpreter and UI. */
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
