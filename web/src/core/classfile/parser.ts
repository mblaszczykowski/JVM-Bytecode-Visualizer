import { ByteReader } from './byte-reader';
import { ClassFileError } from './errors';
import {
  type ClassFile,
  type CodeAttribute,
  ConstantTag,
  type ConstantPool,
  type ConstantPoolEntry,
  type ExceptionTableEntry,
  type FieldInfo,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from './types';

const CLASS_FILE_MAGIC = 0xcafe_babe;

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
  const superClassName =
    superClassIndex === 0
      ? undefined
      : resolveClassName(constantPool, superClassIndex, superClassAt, 'super_class');

  const interfaceNames = readInterfaces(reader, constantPool);
  const fields = readFields(reader, constantPool);
  const methods = readMethods(reader, constantPool);
  readAttributes(reader, constantPool, 'ClassFile');
  if (reader.remaining > 0) {
    throw new ClassFileError({
      kind: 'malformed-structure',
      offset: reader.offset,
      reason: `${String(reader.remaining)} byte(s) after the last class attribute`,
    });
  }

  return {
    minorVersion,
    majorVersion,
    constantPool,
    accessFlags,
    thisClassName,
    ...(superClassName === undefined ? {} : { superClassName }),
    interfaceNames,
    fields,
    methods,
  };
}

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

  const pool: (ConstantPoolEntry | null)[] = new Array<ConstantPoolEntry | null>(count).fill(null);

  for (let index = 1; index < count; index += 1) {
    const tagAt = reader.offset;
    const tag = reader.readU1(`constant_pool[${String(index)}].tag`);
    pool[index] = readConstantEntry(reader, tag, index, tagAt);

    if (tag === ConstantTag.Long || tag === ConstantTag.Double) {
      if (index + 1 >= count) {
        throw new ClassFileError({
          kind: 'malformed-structure',
          offset: tagAt,
          reason: `constant_pool[${String(index)}] is a long or double in the last slot, so the second slot it takes does not exist`,
        });
      }
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
    case ConstantTag.InterfaceMethodref:
      return {
        tag: ConstantTag.InterfaceMethodref,
        classIndex: reader.readU2(field('class_index')),
        nameAndTypeIndex: reader.readU2(field('name_and_type_index')),
      };
    case ConstantTag.NameAndType:
      return {
        tag: ConstantTag.NameAndType,
        nameIndex: reader.readU2(field('name_index')),
        descriptorIndex: reader.readU2(field('descriptor_index')),
      };
    case ConstantTag.MethodHandle:
      return {
        tag: ConstantTag.MethodHandle,
        referenceKind: reader.readU1(field('reference_kind')),
        referenceIndex: reader.readU2(field('reference_index')),
      };
    case ConstantTag.MethodType:
      return {
        tag: ConstantTag.MethodType,
        descriptorIndex: reader.readU2(field('descriptor_index')),
      };
    case ConstantTag.Dynamic:
      return {
        tag: ConstantTag.Dynamic,
        bootstrapMethodAttrIndex: reader.readU2(field('bootstrap_method_attr_index')),
        nameAndTypeIndex: reader.readU2(field('name_and_type_index')),
      };
    case ConstantTag.InvokeDynamic:
      return {
        tag: ConstantTag.InvokeDynamic,
        bootstrapMethodAttrIndex: reader.readU2(field('bootstrap_method_attr_index')),
        nameAndTypeIndex: reader.readU2(field('name_and_type_index')),
      };
    case ConstantTag.Module:
      return { tag: ConstantTag.Module, nameIndex: reader.readU2(field('name_index')) };
    case ConstantTag.Package:
      return { tag: ConstantTag.Package, nameIndex: reader.readU2(field('name_index')) };

    case ConstantTag.Float:
      return { tag: ConstantTag.Float, value: reader.readF4(field('bytes')) };
    case ConstantTag.Long:
      return { tag: ConstantTag.Long, value: reader.readI8(field('bytes')) };
    case ConstantTag.Double:
      return { tag: ConstantTag.Double, value: reader.readF8(field('bytes')) };

    default:
      throw new ClassFileError({
        kind: 'unknown-constant-tag',
        offset: tagAt,
        tag,
        constantPoolIndex: index,
      });
  }
}

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

  const overlong = (position: number, width: number, value: number): ClassFileError =>
    fail(
      position,
      `the ${String(width)}-byte sequence encodes U+${value.toString(16).toUpperCase().padStart(4, '0')}, ` +
        'which JVMS §4.4.7 encodes in fewer bytes',
    );

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
      throw fail(position, 'byte 0x00 is not allowed (U+0000 is encoded as 0xc0 0x80)');
    } else if (lead < 0x80) {
      result += String.fromCharCode(lead);
      position += 1;
    } else if ((lead & 0b1110_0000) === 0b1100_0000) {
      const value = ((lead & 0b0001_1111) << 6) | continuation(position + 1);
      if (value < 0x80 && value !== 0) {
        throw overlong(position, 2, value);
      }
      result += String.fromCharCode(value);
      position += 2;
    } else if ((lead & 0b1111_0000) === 0b1110_0000) {
      const value =
        ((lead & 0b0000_1111) << 12) |
        (continuation(position + 1) << 6) |
        continuation(position + 2);
      if (value < 0x800) {
        throw overlong(position, 3, value);
      }
      result += String.fromCharCode(value);
      position += 3;
    } else {
      throw fail(position, `invalid lead byte 0x${lead.toString(16)}`);
    }
  }

  return result;
}

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

function readMemberHeader(reader: ByteReader, pool: ConstantPool, owner: string): FieldInfo {
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
    readAttributes(reader, pool, owner);
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
      if (name !== 'Code') {
        return;
      }
      if (code !== undefined) {
        throw new ClassFileError({
          kind: 'malformed-structure',
          offset: body.offset,
          reason: `${owner} carries more than one Code attribute, but JVMS §4.7.3 allows exactly one`,
        });
      }
      code = readCodeAttribute(body, pool);
    });

    methods.push(code === undefined ? header : { ...header, code });
  }

  return methods;
}

function readAttributes(
  reader: ByteReader,
  pool: ConstantPool,
  owner: string,
  visit?: (name: string, body: ByteReader) => void,
): void {
  const count = reader.readU2(`${owner}.attributes_count`);

  for (let i = 0; i < count; i += 1) {
    const nameAt = reader.offset;
    const nameIndex = reader.readU2(`${owner}.attributes[${String(i)}].attribute_name_index`);
    const name = resolveUtf8(pool, nameIndex, nameAt, `${owner}.attributes[${String(i)}].name`);
    const length = reader.readU4(`${owner}.attributes[${String(i)}].attribute_length`);
    const body = reader.subReader(length, `${owner}.attributes[${String(i)}] (${name})`);
    visit?.(name, body);
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

  const exceptionTable = readExceptionTable(body, pool);

  const lineNumberTable: LineNumberEntry[] = [];
  const localVariableTable: LocalVariableEntry[] = [];

  readAttributes(body, pool, 'Code', (name, nested) => {
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
    ...(exceptionTable.length > 0 ? { exceptionTable } : {}),
  };
}

function readExceptionTable(body: ByteReader, pool: ConstantPool): readonly ExceptionTableEntry[] {
  const count = body.readU2('Code.exception_table_length');
  const entries: ExceptionTableEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    const owner = `Code.exception_table[${String(i)}]`;
    const startPc = body.readU2(`${owner}.start_pc`);
    const endPc = body.readU2(`${owner}.end_pc`);
    const handlerPc = body.readU2(`${owner}.handler_pc`);
    const catchTypeAt = body.offset;
    const catchTypeIndex = body.readU2(`${owner}.catch_type`);

    entries.push({
      startPc,
      endPc,
      handlerPc,
      ...(catchTypeIndex === 0
        ? {}
        : {
            catchType: resolveClassName(pool, catchTypeIndex, catchTypeAt, `${owner}.catch_type`),
          }),
    });
  }

  return entries;
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
