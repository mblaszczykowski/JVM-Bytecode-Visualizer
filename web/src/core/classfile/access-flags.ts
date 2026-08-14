export const AccessFlag = {
  Public: 0x0001,
  Static: 0x0008,
  Abstract: 0x0400,
} as const;

export function isStatic(accessFlags: number): boolean {
  return (accessFlags & AccessFlag.Static) !== 0;
}

export interface AccessFlagBit {
  readonly bit: number;
  readonly name: string;
}

export const CLASS_ACCESS_FLAGS: readonly AccessFlagBit[] = [
  { bit: 0x0001, name: 'public' },
  { bit: 0x0010, name: 'final' },
  { bit: 0x0020, name: 'super' },
  { bit: 0x0200, name: 'interface' },
  { bit: 0x0400, name: 'abstract' },
  { bit: 0x1000, name: 'synthetic' },
  { bit: 0x2000, name: 'annotation' },
  { bit: 0x4000, name: 'enum' },
  { bit: 0x8000, name: 'module' },
];

export const FIELD_ACCESS_FLAGS: readonly AccessFlagBit[] = [
  { bit: 0x0001, name: 'public' },
  { bit: 0x0002, name: 'private' },
  { bit: 0x0004, name: 'protected' },
  { bit: 0x0008, name: 'static' },
  { bit: 0x0010, name: 'final' },
  { bit: 0x0040, name: 'volatile' },
  { bit: 0x0080, name: 'transient' },
  { bit: 0x1000, name: 'synthetic' },
  { bit: 0x4000, name: 'enum' },
];

export const METHOD_ACCESS_FLAGS: readonly AccessFlagBit[] = [
  { bit: 0x0001, name: 'public' },
  { bit: 0x0002, name: 'private' },
  { bit: 0x0004, name: 'protected' },
  { bit: 0x0008, name: 'static' },
  { bit: 0x0010, name: 'final' },
  { bit: 0x0020, name: 'synchronized' },
  { bit: 0x0040, name: 'bridge' },
  { bit: 0x0080, name: 'varargs' },
  { bit: 0x0100, name: 'native' },
  { bit: 0x0400, name: 'abstract' },
  { bit: 0x0800, name: 'strict' },
  { bit: 0x1000, name: 'synthetic' },
];

export function accessFlagNames(
  accessFlags: number,
  table: readonly AccessFlagBit[],
): readonly string[] {
  return table.filter((flag) => (accessFlags & flag.bit) !== 0).map((flag) => flag.name);
}
