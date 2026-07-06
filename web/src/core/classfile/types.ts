/**
 * Model wyniku parsera plików `.class` — kontrakt plan.md §5.1 (tu w pełnej wersji).
 * Zmiana kontraktu wymaga aktualizacji plan.md i ADR-a w tym samym commicie.
 *
 * Wszystko jest `readonly`: parser zwraca dane, na których disassembler i interpreter
 * tylko czytają (plan.md §11 pkt 2).
 */

/** Tagi wpisów constant poolu — JVMS §4.4, tabela 4.4-B. */
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

/** Tagi czytane wyłącznie po to, żeby poprawnie przejść dalej (plan.md §8 pkt 5). */
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
  /** Zdekodowany zmodyfikowany UTF-8 (JVMS §4.4.7). */
  readonly value: string;
}

export interface IntegerConstant {
  readonly tag: typeof ConstantTag.Integer;
  /** Wartość ze znakiem (int32) — JVMS §4.4.4. */
  readonly value: number;
}

export interface ClassConstant {
  readonly tag: typeof ConstantTag.Class;
  /** Indeks wpisu Utf8 z nazwą wewnętrzną, np. `java/lang/Object`. */
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
 * Wpis o znanej długości, którego treści MVP nie potrzebuje. Zachowujemy sam tag,
 * żeby indeksy puli się zgadzały i żeby UI mogło pokazać rodzaj wpisu.
 */
export interface UninterpretedConstant {
  readonly tag: UninterpretedConstantTag;
}

/** Unia dyskryminowana po `tag` (JVMS §4.4). */
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
 * Pula 1-indeksowana: `[0]` zawsze `null`, tak samo drugi slot każdego wpisu
 * `Long`/`Double` (plan.md §8 pkt 3, JVMS §4.4.5).
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
  /** Numer slotu zmiennych lokalnych ramki. */
  readonly index: number;
}

export interface CodeAttribute {
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly code: Uint8Array;
  /** Obecna, gdy klasę skompilowano z informacją o liniach (javac domyślnie ją emituje). */
  readonly lineNumberTable?: readonly LineNumberEntry[];
  /** Obecna tylko przy `javac -g` — bez niej UI nie zna nazw zmiennych lokalnych. */
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
  /** Brak dla metod `abstract`/`native` (JVMS §4.6). */
  readonly code?: CodeAttribute;
}

export interface ClassFile {
  readonly minorVersion: number;
  /** 65 = Java 21 (JVMS §4.1, tabela 4.1-A). */
  readonly majorVersion: number;
  readonly constantPool: ConstantPool;
  readonly accessFlags: number;
  /** Nazwa wewnętrzna, np. `Factorial` — rozwiązana z constant poolu. */
  readonly thisClassName: string;
  /** Pusty string wyłącznie dla `java/lang/Object`, jedynej klasy bez nadklasy (JVMS §4.1). */
  readonly superClassName: string;
  readonly interfaceNames: readonly string[];
  readonly fields: readonly FieldInfo[];
  readonly methods: readonly MethodInfo[];
}

/** Podzbiór flag dostępu z JVMS §4.6, tabela 4.6-A, używany przez interpreter i UI. */
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
