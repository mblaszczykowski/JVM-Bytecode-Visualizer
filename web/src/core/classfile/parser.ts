import { ByteReader } from './byte-reader';
import { ClassFileError } from './errors';
import {
  type ClassFile,
  type CodeAttribute,
  ConstantTag,
  type ConstantPool,
  type ConstantPoolEntry,
  type FieldInfo,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from './types';

/**
 * Parser plików `.class` (JVMS §4). Zakres: nagłówek, constant pool, flagi, pola,
 * metody, atrybut `Code` wraz z `LineNumberTable` i `LocalVariableTable`
 * (plan.md §9 Faza 1).
 *
 * Zasady, które trzymają parser przy życiu na plikach z prawdziwego javaca:
 * - constant pool jest 1-indeksowany i ma `constant_pool_count - 1` wpisów, a `Long`/`Double`
 *   zajmują po dwa sloty (plan.md §8 pkt 3);
 * - tagi, których nie interpretujemy, i tak mają znane długości i są przeskakiwane (§8 pkt 5);
 * - każdy nieznany atrybut jest pomijany po `attribute_length` — na każdym poziomie (§8 pkt 4);
 * - jedyny wyjątek wychodzący z tego modułu to `ClassFileError`.
 */

/** JVMS §4.1: `magic` ma zawsze wartość 0xCAFEBABE. */
const CLASS_FILE_MAGIC = 0xcafe_babe;

/** JVMS §4.7.3: `code_length` musi być > 0 i < 65536. */
const MAX_CODE_LENGTH = 65_535;

export function parseClassFile(buffer: ArrayBuffer): ClassFile {
  const reader = new ByteReader(buffer);

  const magic = reader.readU4('magic');
  if (magic !== CLASS_FILE_MAGIC) {
    throw new ClassFileError({ kind: 'bad-magic', offset: 0, found: magic });
  }

  const minorVersion = reader.readU2('minor_version');
  const majorVersion = reader.readU2('major_version');
  const constantPool = readConstantPool(reader);
  const accessFlags = reader.readU2('access_flags');

  const thisClassAt = reader.offset;
  const thisClassIndex = reader.readU2('this_class');
  const thisClassName = resolveClassName(constantPool, thisClassIndex, thisClassAt, 'this_class');

  const superClassAt = reader.offset;
  const superClassIndex = reader.readU2('super_class');
  // super_class = 0 występuje wyłącznie w java/lang/Object (JVMS §4.1).
  const superClassName =
    superClassIndex === 0
      ? ''
      : resolveClassName(constantPool, superClassIndex, superClassAt, 'super_class');

  const interfaceNames = readInterfaces(reader, constantPool);
  const fields = readFields(reader, constantPool);
  const methods = readMethods(reader, constantPool);
  // Atrybuty klasy (SourceFile, NestMembers, InnerClasses...) czytamy tylko po to,
  // żeby potwierdzić spójność pliku — żaden z nich nie jest potrzebny w MVP.
  readAttributes(reader, constantPool, 'ClassFile', () => undefined);

  return {
    minorVersion,
    majorVersion,
    constantPool,
    accessFlags,
    thisClassName,
    superClassName,
    interfaceNames,
    fields,
    methods,
  };
}

// --- Constant pool (JVMS §4.4) ---------------------------------------------------------------

function readConstantPool(reader: ByteReader): ConstantPool {
  const countAt = reader.offset;
  const count = reader.readU2('constant_pool_count');
  if (count === 0) {
    throw new ClassFileError({
      kind: 'malformed-structure',
      offset: countAt,
      reason: 'constant_pool_count = 0, a pula jest 1-indeksowana (minimum to 1)',
    });
  }

  // Indeks 0 jest nieużywany i zostaje `null` — tak samo drugi slot wpisów Long/Double.
  const pool: (ConstantPoolEntry | null)[] = new Array<ConstantPoolEntry | null>(count).fill(null);

  for (let index = 1; index < count; index += 1) {
    const tagAt = reader.offset;
    const tag = reader.readU1(`constant_pool[${String(index)}].tag`);
    pool[index] = readConstantEntry(reader, tag, index, tagAt);

    if (tag === ConstantTag.Long || tag === ConstantTag.Double) {
      // JVMS §4.4.5: „ośmiobajtowe stałe zajmują dwa wpisy tablicy constant_pool”.
      index += 1;
    }
  }

  return pool;
}

function readConstantEntry(
  reader: ByteReader,
  tag: number,
  index: number,
  tagAt: number,
): ConstantPoolEntry {
  const field = (name: string): string => `constant_pool[${String(index)}].${name}`;

  switch (tag) {
    case ConstantTag.Utf8: {
      const length = reader.readU2(field('length'));
      const bytesAt = reader.offset;
      const bytes = reader.readBytes(length, field('bytes'));
      return { tag: ConstantTag.Utf8, value: decodeModifiedUtf8(bytes, index, bytesAt) };
    }
    case ConstantTag.Integer:
      // JVMS §4.4.4: CONSTANT_Integer trzyma int ze znakiem; `| 0` reinterpretuje
      // odczytane u4 jako int32 (jedyna sensowna konwersja bez readI4 w ByteReaderze).
      return { tag: ConstantTag.Integer, value: reader.readU4(field('bytes')) | 0 };
    case ConstantTag.Class:
      return { tag: ConstantTag.Class, nameIndex: reader.readU2(field('name_index')) };
    case ConstantTag.String:
      return { tag: ConstantTag.String, stringIndex: reader.readU2(field('string_index')) };
    case ConstantTag.Fieldref:
      return {
        tag: ConstantTag.Fieldref,
        classIndex: reader.readU2(field('class_index')),
        nameAndTypeIndex: reader.readU2(field('name_and_type_index')),
      };
    case ConstantTag.Methodref:
      return {
        tag: ConstantTag.Methodref,
        classIndex: reader.readU2(field('class_index')),
        nameAndTypeIndex: reader.readU2(field('name_and_type_index')),
      };
    case ConstantTag.NameAndType:
      return {
        tag: ConstantTag.NameAndType,
        nameIndex: reader.readU2(field('name_index')),
        descriptorIndex: reader.readU2(field('descriptor_index')),
      };

    // Tagi znane, ale nieinterpretowane — czytane wyłącznie po to, żeby kursor stanął
    // na następnym wpisie (plan.md §8 pkt 5). Długości wg JVMS §4.4.
    case ConstantTag.Float:
      reader.skip(4, field('bytes'));
      return { tag: ConstantTag.Float };
    case ConstantTag.Long:
      reader.skip(8, field('bytes'));
      return { tag: ConstantTag.Long };
    case ConstantTag.Double:
      reader.skip(8, field('bytes'));
      return { tag: ConstantTag.Double };
    case ConstantTag.InterfaceMethodref:
      reader.skip(4, field('class_index/name_and_type_index'));
      return { tag: ConstantTag.InterfaceMethodref };
    case ConstantTag.MethodHandle:
      reader.skip(3, field('reference_kind/reference_index'));
      return { tag: ConstantTag.MethodHandle };
    case ConstantTag.MethodType:
      reader.skip(2, field('descriptor_index'));
      return { tag: ConstantTag.MethodType };
    case ConstantTag.Dynamic:
      reader.skip(4, field('bootstrap_method_attr_index/name_and_type_index'));
      return { tag: ConstantTag.Dynamic };
    case ConstantTag.InvokeDynamic:
      reader.skip(4, field('bootstrap_method_attr_index/name_and_type_index'));
      return { tag: ConstantTag.InvokeDynamic };
    case ConstantTag.Module:
      reader.skip(2, field('name_index'));
      return { tag: ConstantTag.Module };
    case ConstantTag.Package:
      reader.skip(2, field('name_index'));
      return { tag: ConstantTag.Package };

    default:
      // Wpisy puli mają różne długości — bez znajomości tagu nie da się przejść
      // do następnego wpisu, więc dalszy odczyt nie miałby sensu.
      throw new ClassFileError({
        kind: 'unknown-constant-tag',
        offset: tagAt,
        tag,
        constantPoolIndex: index,
      });
  }
}

/**
 * Dekoder zmodyfikowanego UTF-8 (JVMS §4.4.7): jak UTF-8, ale U+0000 zapisuje się
 * dwubajtowo (0xC0 0x80), a znaki spoza BMP dwiema sekwencjami trzybajtowymi
 * (parą surogatów), nie jedną czterobajtową.
 *
 * Ponieważ string w JS jest ciągiem jednostek UTF-16, para surogatów odtwarza się tu
 * sama z siebie — dekodowanie 1/2/3-bajtowych sekwencji pokrywa cały format, łącznie
 * ze znakami spoza BMP. Ograniczenie: nie weryfikujemy nadmiarowo długich kodowań
 * ani poprawnego sparowania surogatów (w plikach z javaca nie występują, a błąd i tak
 * nie prowadzi do niepoprawnego odczytu kolejnych struktur — długość wpisu znamy z góry).
 */
function decodeModifiedUtf8(bytes: Uint8Array, constantPoolIndex: number, bytesAt: number): string {
  const byteAt = (position: number): number => {
    const value = bytes[position];
    if (value === undefined) {
      throw new ClassFileError({
        kind: 'malformed-utf8',
        offset: bytesAt + position,
        constantPoolIndex,
        reason: 'sekwencja wielobajtowa urwana na końcu wpisu',
      });
    }
    return value;
  };

  const fail = (position: number, reason: string): ClassFileError =>
    new ClassFileError({
      kind: 'malformed-utf8',
      offset: bytesAt + position,
      constantPoolIndex,
      reason,
    });

  const continuation = (position: number): number => {
    const value = byteAt(position);
    if ((value & 0b1100_0000) !== 0b1000_0000) {
      throw fail(
        position,
        `oczekiwano bajtu kontynuacji 10xxxxxx, znaleziono 0x${value.toString(16)}`,
      );
    }
    return value & 0b0011_1111;
  };

  let result = '';
  let position = 0;
  while (position < bytes.length) {
    const lead = byteAt(position);

    if (lead === 0x00) {
      // U+0000 musi być zapisane jako 0xC0 0x80 — goły zerowy bajt jest niedozwolony.
      throw fail(position, 'bajt 0x00 jest niedozwolony (U+0000 koduje się jako 0xc0 0x80)');
    } else if (lead < 0x80) {
      result += String.fromCharCode(lead);
      position += 1;
    } else if ((lead & 0b1110_0000) === 0b1100_0000) {
      result += String.fromCharCode(((lead & 0b0001_1111) << 6) | continuation(position + 1));
      position += 2;
    } else if ((lead & 0b1111_0000) === 0b1110_0000) {
      result += String.fromCharCode(
        ((lead & 0b0000_1111) << 12) |
          (continuation(position + 1) << 6) |
          continuation(position + 2),
      );
      position += 3;
    } else {
      throw fail(position, `nieprawidłowy bajt wiodący 0x${lead.toString(16)}`);
    }
  }

  return result;
}

// --- Rozwiązywanie odwołań do puli ------------------------------------------------------------

function constantAt(
  pool: ConstantPool,
  index: number,
  offset: number,
  context: string,
  expected: string,
): ConstantPoolEntry {
  const entry = index >= 0 && index < pool.length ? pool[index] : undefined;
  if (entry === undefined || entry === null) {
    throw new ClassFileError({ kind: 'bad-index', offset, index, expected, context });
  }
  return entry;
}

function resolveUtf8(pool: ConstantPool, index: number, offset: number, context: string): string {
  const entry = constantAt(pool, index, offset, context, 'Utf8');
  if (entry.tag !== ConstantTag.Utf8) {
    throw new ClassFileError({ kind: 'bad-index', offset, index, expected: 'Utf8', context });
  }
  return entry.value;
}

function resolveClassName(
  pool: ConstantPool,
  index: number,
  offset: number,
  context: string,
): string {
  const entry = constantAt(pool, index, offset, context, 'Class');
  if (entry.tag !== ConstantTag.Class) {
    throw new ClassFileError({ kind: 'bad-index', offset, index, expected: 'Class', context });
  }
  return resolveUtf8(pool, entry.nameIndex, offset, `${context} → Class.name_index`);
}

// --- Interfejsy, pola, metody (JVMS §4.1, §4.5, §4.6) -----------------------------------------

function readInterfaces(reader: ByteReader, pool: ConstantPool): readonly string[] {
  const count = reader.readU2('interfaces_count');
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = reader.offset;
    const index = reader.readU2(`interfaces[${String(i)}]`);
    names.push(resolveClassName(pool, index, at, `interfaces[${String(i)}]`));
  }
  return names;
}

interface MemberHeader {
  readonly accessFlags: number;
  readonly name: string;
  readonly descriptor: string;
}

function readMemberHeader(reader: ByteReader, pool: ConstantPool, owner: string): MemberHeader {
  const accessFlags = reader.readU2(`${owner}.access_flags`);
  const nameAt = reader.offset;
  const nameIndex = reader.readU2(`${owner}.name_index`);
  const descriptorAt = reader.offset;
  const descriptorIndex = reader.readU2(`${owner}.descriptor_index`);

  return {
    accessFlags,
    name: resolveUtf8(pool, nameIndex, nameAt, `${owner}.name_index`),
    descriptor: resolveUtf8(pool, descriptorIndex, descriptorAt, `${owner}.descriptor_index`),
  };
}

function readFields(reader: ByteReader, pool: ConstantPool): readonly FieldInfo[] {
  const count = reader.readU2('fields_count');
  const fields: FieldInfo[] = [];

  for (let i = 0; i < count; i += 1) {
    const owner = `fields[${String(i)}]`;
    const header = readMemberHeader(reader, pool, owner);
    // MVP nie zna pól (ADR-0002: brak heapu) — czytamy je tylko strukturalnie,
    // żeby kursor stanął na tablicy metod. Atrybuty pola pomijamy w całości.
    readAttributes(reader, pool, owner, () => undefined);
    fields.push(header);
  }

  return fields;
}

function readMethods(reader: ByteReader, pool: ConstantPool): readonly MethodInfo[] {
  const count = reader.readU2('methods_count');
  const methods: MethodInfo[] = [];

  for (let i = 0; i < count; i += 1) {
    const owner = `methods[${String(i)}]`;
    const header = readMemberHeader(reader, pool, owner);

    let code: CodeAttribute | undefined;
    readAttributes(reader, pool, owner, (name, body) => {
      // JVMS §4.7.3: metoda ma najwyżej jeden atrybut Code; ewentualne kolejne ignorujemy.
      if (name === 'Code' && code === undefined) {
        code = readCodeAttribute(body, pool);
      }
    });

    methods.push(code === undefined ? header : { ...header, code });
  }

  return methods;
}

// --- Atrybuty (JVMS §4.7) ---------------------------------------------------------------------

/**
 * Czyta tablicę atrybutów i woła `visit` dla każdego z nich, podając czytnik ograniczony
 * do ciała atrybutu. Kursor rodzica przeskakuje atrybut po `attribute_length` niezależnie
 * od tego, ile bajtów przeczytał `visit` — to jest realizacja plan.md §8 pkt 4 dla
 * wszystkich poziomów (klasa/pole/metoda/Code).
 */
function readAttributes(
  reader: ByteReader,
  pool: ConstantPool,
  owner: string,
  visit: (name: string, body: ByteReader) => void,
): void {
  const count = reader.readU2(`${owner}.attributes_count`);

  for (let i = 0; i < count; i += 1) {
    const nameAt = reader.offset;
    const nameIndex = reader.readU2(`${owner}.attributes[${String(i)}].attribute_name_index`);
    const name = resolveUtf8(pool, nameIndex, nameAt, `${owner}.attributes[${String(i)}].name`);
    const length = reader.readU4(`${owner}.attributes[${String(i)}].attribute_length`);
    const body = reader.subReader(length, `${owner}.attributes[${String(i)}] (${name})`);
    visit(name, body);
  }
}

function readCodeAttribute(body: ByteReader, pool: ConstantPool): CodeAttribute {
  const maxStack = body.readU2('Code.max_stack');
  const maxLocals = body.readU2('Code.max_locals');

  const codeLengthAt = body.offset;
  const codeLength = body.readU4('Code.code_length');
  if (codeLength === 0 || codeLength > MAX_CODE_LENGTH) {
    throw new ClassFileError({
      kind: 'malformed-structure',
      offset: codeLengthAt,
      reason: `code_length = ${String(codeLength)}, a JVMS §4.7.3 wymaga wartości z zakresu 1..${String(MAX_CODE_LENGTH)}`,
    });
  }
  const code = body.readBytes(codeLength, 'Code.code');

  // Tablica wyjątków jest czytana i świadomie ignorowana — wyjątki są poza MVP (plan.md §10).
  const exceptionTableLength = body.readU2('Code.exception_table_length');
  for (let i = 0; i < exceptionTableLength; i += 1) {
    body.skip(8, `Code.exception_table[${String(i)}]`);
  }

  const lineNumberTable: LineNumberEntry[] = [];
  const localVariableTable: LocalVariableEntry[] = [];

  readAttributes(body, pool, 'Code', (name, nested) => {
    // JVMS §4.7.12/§4.7.13 dopuszczają wiele takich atrybutów w jednym Code — sklejamy je.
    if (name === 'LineNumberTable') {
      lineNumberTable.push(...readLineNumberTable(nested));
    } else if (name === 'LocalVariableTable') {
      localVariableTable.push(...readLocalVariableTable(nested, pool));
    }
  });

  return {
    maxStack,
    maxLocals,
    code,
    ...(lineNumberTable.length > 0 ? { lineNumberTable } : {}),
    ...(localVariableTable.length > 0 ? { localVariableTable } : {}),
  };
}

function readLineNumberTable(body: ByteReader): readonly LineNumberEntry[] {
  const count = body.readU2('LineNumberTable.line_number_table_length');
  const entries: LineNumberEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    entries.push({
      startPc: body.readU2(`LineNumberTable[${String(i)}].start_pc`),
      lineNumber: body.readU2(`LineNumberTable[${String(i)}].line_number`),
    });
  }

  return entries;
}

function readLocalVariableTable(
  body: ByteReader,
  pool: ConstantPool,
): readonly LocalVariableEntry[] {
  const count = body.readU2('LocalVariableTable.local_variable_table_length');
  const entries: LocalVariableEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    const startPc = body.readU2(`LocalVariableTable[${String(i)}].start_pc`);
    const length = body.readU2(`LocalVariableTable[${String(i)}].length`);
    const nameAt = body.offset;
    const nameIndex = body.readU2(`LocalVariableTable[${String(i)}].name_index`);
    const descriptorAt = body.offset;
    const descriptorIndex = body.readU2(`LocalVariableTable[${String(i)}].descriptor_index`);
    const index = body.readU2(`LocalVariableTable[${String(i)}].index`);

    entries.push({
      startPc,
      length,
      name: resolveUtf8(pool, nameIndex, nameAt, `LocalVariableTable[${String(i)}].name_index`),
      descriptor: resolveUtf8(
        pool,
        descriptorIndex,
        descriptorAt,
        `LocalVariableTable[${String(i)}].descriptor_index`,
      ),
      index,
    });
  }

  return entries;
}
