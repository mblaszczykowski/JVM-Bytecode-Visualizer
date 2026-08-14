import { ClassFileError } from './errors';

export type PrimitiveTypeName =
  'boolean' | 'byte' | 'char' | 'short' | 'int' | 'long' | 'float' | 'double';

export interface PrimitiveType {
  readonly kind: 'primitive';
  readonly name: PrimitiveTypeName;
}

export interface ClassType {
  readonly kind: 'class';
  readonly className: string;
}

export interface ArrayType {
  readonly kind: 'array';
  readonly elementType: JvmType;
}

export type JvmType = PrimitiveType | ClassType | ArrayType;

export interface VoidType {
  readonly kind: 'void';
}

export type JvmReturnType = JvmType | VoidType;

export interface MethodDescriptor {
  readonly params: readonly JvmType[];
  readonly returnType: JvmReturnType;
}

const PRIMITIVE_BY_TAG: Readonly<Record<string, PrimitiveTypeName | undefined>> = {
  B: 'byte',
  C: 'char',
  D: 'double',
  F: 'float',
  I: 'int',
  J: 'long',
  S: 'short',
  Z: 'boolean',
};

const MAX_ARRAY_DIMENSIONS = 255;

export function parseMethodDescriptor(descriptor: string): MethodDescriptor {
  if (!descriptor.startsWith('(')) {
    throw malformed(descriptor, 0, 'a method descriptor must start with "("');
  }

  const params: JvmType[] = [];
  let position = 1;
  while (position < descriptor.length && descriptor[position] !== ')') {
    const parsed = parseFieldType(descriptor, position);
    params.push(parsed.type);
    position = parsed.next;
  }
  if (position >= descriptor.length) {
    throw malformed(descriptor, position, 'missing closing ")" of the parameter list');
  }
  position += 1;

  const returnType = parseReturnType(descriptor, position);
  if (returnType.next !== descriptor.length) {
    throw malformed(descriptor, returnType.next, 'trailing characters after the return type');
  }

  return { params, returnType: returnType.type };
}

export function parseFieldDescriptor(descriptor: string): JvmType {
  const parsed = parseFieldType(descriptor, 0);
  if (parsed.next !== descriptor.length) {
    throw malformed(descriptor, parsed.next, 'trailing characters after the field descriptor');
  }
  return parsed.type;
}

export function formatJvmType(type: JvmReturnType): string {
  switch (type.kind) {
    case 'void':
      return 'void';
    case 'primitive':
      return type.name;
    case 'class':
      return type.className.replaceAll('/', '.');
    case 'array':
      return `${formatJvmType(type.elementType)}[]`;
  }
}

interface ParsedType<T> {
  readonly type: T;
  readonly next: number;
}

function parseReturnType(descriptor: string, position: number): ParsedType<JvmReturnType> {
  if (descriptor[position] === 'V') {
    return { type: { kind: 'void' }, next: position + 1 };
  }
  return parseFieldType(descriptor, position);
}

function parseFieldType(descriptor: string, position: number): ParsedType<JvmType> {
  let dimensions = 0;
  let cursor = position;
  while (descriptor[cursor] === '[') {
    dimensions += 1;
    cursor += 1;
  }
  if (dimensions > MAX_ARRAY_DIMENSIONS) {
    throw malformed(
      descriptor,
      position,
      `the array has ${String(dimensions)} dimensions, the maximum is ${String(MAX_ARRAY_DIMENSIONS)}`,
    );
  }

  const parsed = parseComponentType(descriptor, cursor);
  let type = parsed.type;
  for (let i = 0; i < dimensions; i += 1) {
    type = { kind: 'array', elementType: type };
  }
  return { type, next: parsed.next };
}

function parseComponentType(descriptor: string, position: number): ParsedType<JvmType> {
  const tag = descriptor[position];
  if (tag === undefined) {
    throw malformed(descriptor, position, 'unexpected end of descriptor');
  }

  const primitive = PRIMITIVE_BY_TAG[tag];
  if (primitive !== undefined) {
    return { type: { kind: 'primitive', name: primitive }, next: position + 1 };
  }

  if (tag === 'L') {
    const end = descriptor.indexOf(';', position + 1);
    if (end === -1) {
      throw malformed(descriptor, position, 'object type descriptor without a closing ";"');
    }
    const className = descriptor.slice(position + 1, end);
    if (className.length === 0) {
      throw malformed(descriptor, position, 'empty class name in an "L;" descriptor');
    }
    return { type: { kind: 'class', className }, next: end + 1 };
  }

  throw malformed(descriptor, position, `unknown type character "${tag}"`);
}

function malformed(descriptor: string, position: number, reason: string): ClassFileError {
  return new ClassFileError({ kind: 'malformed-descriptor', descriptor, position, reason });
}
