import { ClassFileError } from './errors';

/**
 * Parser deskryptorów pól i metod — JVMS §4.3.2 (FieldDescriptor) i §4.3.3 (MethodDescriptor).
 *
 * Gramatyka jest zaimplementowana w całości (`B C D F I J S Z`, `L<nazwa>;`, `[`), mimo że
 * interpreter MVP dopuszcza wyłącznie parametry `I` i zwrotki `I`/`V` (plan.md §8 pkt 6).
 * Ograniczenie zakresu egzekwuje Faza 3 — parser ma mówić prawdę o pliku, a nie o MVP:
 * dzięki temu komunikat brzmi „nieobsługiwany typ parametru: long”, a nie „nieznany deskryptor”.
 */

export type PrimitiveTypeName =
  'boolean' | 'byte' | 'char' | 'short' | 'int' | 'long' | 'float' | 'double';

export interface PrimitiveType {
  readonly kind: 'primitive';
  readonly name: PrimitiveTypeName;
}

export interface ClassType {
  readonly kind: 'class';
  /** Nazwa wewnętrzna z deskryptora, np. `java/lang/String`. */
  readonly className: string;
}

export interface ArrayType {
  readonly kind: 'array';
  /** Typ komponentu; tablice wielowymiarowe to zagnieżdżone `ArrayType`. */
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

/** JVMS §4.3.2: deskryptor tablicy jest poprawny tylko do 255 wymiarów. */
const MAX_ARRAY_DIMENSIONS = 255;

/** `"(II)I"` → dwa `int`-y i zwrotka `int`. */
export function parseMethodDescriptor(descriptor: string): MethodDescriptor {
  if (!descriptor.startsWith('(')) {
    throw malformed(descriptor, 0, 'deskryptor metody musi zaczynać się od "("');
  }

  const params: JvmType[] = [];
  let position = 1;
  while (descriptor[position] !== ')') {
    if (position >= descriptor.length) {
      throw malformed(descriptor, position, 'brak nawiasu zamykającego ")" listy parametrów');
    }
    const parsed = parseFieldType(descriptor, position);
    params.push(parsed.type);
    position = parsed.next;
  }
  position += 1; // znak ')'

  const returnType = parseReturnType(descriptor, position);
  if (returnType.next !== descriptor.length) {
    throw malformed(
      descriptor,
      returnType.next,
      'nadmiarowe znaki za deskryptorem zwracanego typu',
    );
  }

  return { params, returnType: returnType.type };
}

/** Deskryptor pola / zmiennej lokalnej, np. `"[Ljava/lang/String;"` (JVMS §4.3.2). */
export function parseFieldDescriptor(descriptor: string): JvmType {
  const parsed = parseFieldType(descriptor, 0);
  if (parsed.next !== descriptor.length) {
    throw malformed(descriptor, parsed.next, 'nadmiarowe znaki za deskryptorem pola');
  }
  return parsed.type;
}

/** Nazwa typu w konwencji źródła Java — do listingów i komunikatów UI. */
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
  /** Pozycja pierwszego znaku za sparsowanym typem. */
  readonly next: number;
}

function parseReturnType(descriptor: string, position: number): ParsedType<JvmReturnType> {
  if (descriptor[position] === 'V') {
    return { type: { kind: 'void' }, next: position + 1 };
  }
  return parseFieldType(descriptor, position);
}

function parseFieldType(descriptor: string, position: number): ParsedType<JvmType> {
  // Wymiary zliczamy iteracyjnie (a nie rekurencyjnie), żeby patologiczny deskryptor
  // z tysiącami "[" nie przewrócił parsera przepełnieniem stosu.
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
      `tablica ma ${String(dimensions)} wymiarów, maksimum to ${String(MAX_ARRAY_DIMENSIONS)}`,
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
    throw malformed(descriptor, position, 'nieoczekiwany koniec deskryptora');
  }

  const primitive = PRIMITIVE_BY_TAG[tag];
  if (primitive !== undefined) {
    return { type: { kind: 'primitive', name: primitive }, next: position + 1 };
  }

  if (tag === 'L') {
    const end = descriptor.indexOf(';', position + 1);
    if (end === -1) {
      throw malformed(descriptor, position, 'deskryptor typu obiektowego bez zamykającego ";"');
    }
    const className = descriptor.slice(position + 1, end);
    if (className.length === 0) {
      throw malformed(descriptor, position, 'pusta nazwa klasy w deskryptorze "L;"');
    }
    return { type: { kind: 'class', className }, next: end + 1 };
  }

  throw malformed(descriptor, position, `nieznany znak typu "${tag}"`);
}

function malformed(descriptor: string, position: number, reason: string): ClassFileError {
  return new ClassFileError({ kind: 'malformed-descriptor', descriptor, position, reason });
}
