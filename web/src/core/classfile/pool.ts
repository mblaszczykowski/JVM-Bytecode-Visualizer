import { ConstantTag, type ConstantPool, type ConstantPoolEntry } from './types';

export function poolEntry(pool: ConstantPool, index: number): ConstantPoolEntry | undefined {
  return pool[index] ?? undefined;
}

export function utf8At(pool: ConstantPool, index: number): string | undefined {
  const entry = poolEntry(pool, index);
  return entry?.tag === ConstantTag.Utf8 ? entry.value : undefined;
}

export function classNameAt(pool: ConstantPool, index: number): string | undefined {
  const entry = poolEntry(pool, index);
  return entry?.tag === ConstantTag.Class ? utf8At(pool, entry.nameIndex) : undefined;
}

export interface NameAndType {
  readonly name: string;
  readonly descriptor: string;
}

export function nameAndTypeAt(pool: ConstantPool, index: number): NameAndType | undefined {
  const entry = poolEntry(pool, index);
  if (entry?.tag !== ConstantTag.NameAndType) {
    return undefined;
  }
  const name = utf8At(pool, entry.nameIndex);
  const descriptor = utf8At(pool, entry.descriptorIndex);
  return name === undefined || descriptor === undefined ? undefined : { name, descriptor };
}
