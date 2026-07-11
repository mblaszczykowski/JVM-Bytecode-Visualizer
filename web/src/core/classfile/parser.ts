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
 * `.class` file parser (JVMS §4). Scope: header, constant pool, flags, fields, methods
 * and the `Code` attribute together with `LineNumberTable` and `LocalVariableTable`.
 *
 * The rules that keep the parser alive on files produced by a real javac:
 * - the constant pool is 1-indexed and holds `constant_pool_count - 1` entries, with
 *   `Long`/`Double` taking two slots each (JVMS §4.4.5);
 * - tags we do not interpret still have known lengths and are skipped over;
 * - every unknown attribute is skipped by `attribute_length` — at every level (JVMS §4.7);
 * - the only exception leaving this module is `ClassFileError`.
 */

/** JVMS §4.1: `magic` always equals 0xCAFEBABE. */
const CLASS_FILE_MAGIC = 0xcafe_babe;

/** JVMS §4.7.3: `code_length` must be > 0 and < 65536. */
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
  // super_class = 0 occurs only in java/lang/Object (JVMS §4.1).
  const superClassName =
    superClassIndex === 0
      ? ''
      : resolveClassName(constantPool, superClassIndex, superClassAt, 'super_class');

  const interfaceNames = readInterfaces(reader, constantPool);
  const fields = readFields(reader, constantPool);
  const methods = readMethods(reader, constantPool);
  // Class attributes (SourceFile, NestMembers, InnerClasses...) are read only to confirm
  // the file is structurally consistent — none of them is needed by the MVP.
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
      reason: 'constant_pool_count = 0, but the pool is 1-indexed (the minimum is 1)',
    });
  }

  // Index 0 is unused and stays `null` — so does the second slot of Long/Double entries.
  const pool: (ConstantPoolEntry | null)[] = new Array<ConstantPoolEntry | null>(count).fill(null);

  for (let index = 1; index < count; index += 1) {
    const tagAt = reader.offset;
    const tag = reader.readU1(`constant_pool[${String(index)}].tag`);
    pool[index] = readConstantEntry(reader, tag, index, tagAt);

    if (tag === ConstantTag.Long || tag === ConstantTag.Double) {
      // JVMS §4.4.5: "eight-byte constants take up two entries in the constant_pool table".
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
      // JVMS §4.4.4: CONSTANT_Integer holds a signed int; `| 0` reinterprets the u4 just
      // read as an int32 (the only sensible conversion without a readI4 on ByteReader).
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

    // Tags that are known but not interpreted — read only so the cursor lands on the next
    // entry. Lengths per JVMS §4.4.
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
      // Pool entries have different lengths — without knowing the tag there is no way to
      // advance to the next entry, so reading any further would be meaningless.
      throw new ClassFileError({
        kind: 'unknown-constant-tag',
        offset: tagAt,
        tag,
        constantPoolIndex: index,
      });
  }
}

/**
 * Modified UTF-8 decoder (JVMS §4.4.7): like UTF-8, except U+0000 is encoded on two bytes
 * (0xC0 0x80) and characters outside the BMP use two three-byte sequences (a surrogate
 * pair) instead of a single four-byte one.
 *
 * Because a JS string is a sequence of UTF-16 code units, the surrogate pair reassembles
 * itself here — decoding 1/2/3-byte sequences covers the whole format, including
 * supplementary characters. Limitation: overlong encodings and surrogate pairing are not
 * validated (javac never emits them, and either way the entry length is known up front,
 * so a bad string cannot desynchronise the reads that follow).
 */
function decodeModifiedUtf8(bytes: Uint8Array, constantPoolIndex: number, bytesAt: number): string {
  const byteAt = (position: number): number => {
    const value = bytes[position];
    if (value === undefined) {
      throw new ClassFileError({
        kind: 'malformed-utf8',
        offset: bytesAt + position,
        constantPoolIndex,
        reason: 'multi-byte sequence truncated at the end of the entry',
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
      throw fail(position, `expected a 10xxxxxx continuation byte, found 0x${value.toString(16)}`);
    }
    return value & 0b0011_1111;
  };

  let result = '';
  let position = 0;
  while (position < bytes.length) {
    const lead = byteAt(position);

    if (lead === 0x00) {
      // U+0000 must be encoded as 0xC0 0x80 — a bare zero byte is not allowed.
      throw fail(position, 'byte 0x00 is not allowed (U+0000 is encoded as 0xc0 0x80)');
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
      throw fail(position, `invalid lead byte 0x${lead.toString(16)}`);
    }
  }

  return result;
}

// --- Resolving constant pool references -------------------------------------------------------

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

// --- Interfaces, fields, methods (JVMS §4.1, §4.5, §4.6) --------------------------------------

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
    // The MVP has no notion of fields (no heap) — they are read structurally only, so the
    // cursor lands on the methods table. Field attributes are skipped entirely.
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
      // JVMS §4.7.3: a method has at most one Code attribute; any further ones are ignored.
      if (name === 'Code' && code === undefined) {
        code = readCodeAttribute(body, pool);
      }
    });

    methods.push(code === undefined ? header : { ...header, code });
  }

  return methods;
}

// --- Attributes (JVMS §4.7) -------------------------------------------------------------------

/**
 * Reads an attributes table and calls `visit` for each entry with a reader limited to the
 * attribute body. The parent cursor skips the attribute by `attribute_length` no matter how
 * many bytes `visit` consumed — this holds at every level (class/field/method/Code).
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
      reason: `code_length = ${String(codeLength)}, but JVMS §4.7.3 requires a value in 1..${String(MAX_CODE_LENGTH)}`,
    });
  }
  const code = body.readBytes(codeLength, 'Code.code');

  // The exception table is read and deliberately ignored — exceptions are out of MVP scope.
  const exceptionTableLength = body.readU2('Code.exception_table_length');
  for (let i = 0; i < exceptionTableLength; i += 1) {
    body.skip(8, `Code.exception_table[${String(i)}]`);
  }

  const lineNumberTable: LineNumberEntry[] = [];
  const localVariableTable: LocalVariableEntry[] = [];

  readAttributes(body, pool, 'Code', (name, nested) => {
    // JVMS §4.7.12/§4.7.13 allow several such attributes in one Code — concatenate them.
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
