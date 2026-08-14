import { OPCODES, type OpcodeInfo } from '../../core/disassembler';
import { EXECUTABLE_OPCODES } from '../../core/interpreter';

export interface InstructionFamily {
  readonly name: string;
  readonly mnemonics: readonly string[];
}

export interface FeatureGap {
  readonly title: string;
  readonly missing: readonly string[];
}

export interface CapabilitySummary {
  readonly executable: number;
  readonly assigned: number;
  readonly families: readonly InstructionFamily[];
  readonly gaps: readonly FeatureGap[];
}

export const CALL_SCOPE_NOTE =
  'Everything must resolve inside the loaded class or in the small slice of the standard library this machine models. Its objects, constructors, instance methods and fields run, and so do System.out printing and the Math helpers; anything else stops the run.';

type OpcodeRange = readonly [first: number, last: number];

interface FamilySpec {
  readonly name: string;
  readonly ranges: readonly OpcodeRange[];
}

const FAMILIES: readonly FamilySpec[] = [
  { name: 'Constants', ranges: [[0x00, 0x14]] },
  {
    name: 'Loads and stores',
    ranges: [
      [0x15, 0x56],
      [0xc4, 0xc4],
    ],
  },
  { name: 'Operand stack', ranges: [[0x57, 0x5f]] },
  { name: 'Arithmetic and logic', ranges: [[0x60, 0x84]] },
  { name: 'Type conversions', ranges: [[0x85, 0x93]] },
  {
    name: 'Comparisons and branches',
    ranges: [
      [0x94, 0xa6],
      [0xc6, 0xc7],
    ],
  },
  {
    name: 'Jumps and switches',
    ranges: [
      [0xa7, 0xab],
      [0xc8, 0xc9],
    ],
  },
  {
    name: 'Method calls and returns',
    ranges: [
      [0xac, 0xb1],
      [0xb6, 0xba],
    ],
  },
  { name: 'Field access', ranges: [[0xb2, 0xb5]] },
  {
    name: 'Objects and arrays',
    ranges: [
      [0xbb, 0xbe],
      [0xc0, 0xc1],
      [0xc5, 0xc5],
    ],
  },
  {
    name: 'Exceptions and locks',
    ranges: [
      [0xbf, 0xbf],
      [0xc2, 0xc3],
    ],
  },
];

interface FeatureSpec {
  readonly title: string;
  readonly requires: readonly string[];
}

const FEATURES: readonly FeatureSpec[] = [
  { title: 'Printing to the console', requires: ['getstatic', 'invokevirtual'] },
  { title: 'String literals and other pooled constants', requires: ['ldc'] },
  { title: 'long, float and double values', requires: ['ladd', 'fadd', 'dadd'] },
  { title: 'switch statements', requires: ['tableswitch', 'lookupswitch'] },
  { title: 'Bitwise operators and shifts', requires: ['iand', 'ior', 'ixor', 'ishl', 'ishr'] },
  { title: 'Static fields: state that outlives every instance', requires: ['putstatic'] },
  {
    title: 'Interfaces, lambdas and method references',
    requires: ['invokeinterface', 'invokedynamic'],
  },
  { title: 'Casts and type tests', requires: ['checkcast', 'instanceof'] },
  { title: 'Arrays of anything but int', requires: ['anewarray', 'aaload', 'baload', 'caload'] },
];

const ASSIGNED: readonly OpcodeInfo[] = [...OPCODES.values()].sort((a, b) => a.opcode - b.opcode);

const MNEMONIC_TO_OPCODE: ReadonlyMap<string, number> = new Map(
  ASSIGNED.map((info) => [info.mnemonic, info.opcode]),
);

function contains(ranges: readonly OpcodeRange[], opcode: number): boolean {
  return ranges.some(([first, last]) => opcode >= first && opcode <= last);
}

export function isExecutableMnemonic(mnemonic: string): boolean {
  const opcode = MNEMONIC_TO_OPCODE.get(mnemonic);
  return opcode !== undefined && EXECUTABLE_OPCODES.has(opcode);
}

export function executableFamilies(): readonly InstructionFamily[] {
  const families: InstructionFamily[] = [];
  for (const spec of FAMILIES) {
    const mnemonics = ASSIGNED.filter(
      (info) => EXECUTABLE_OPCODES.has(info.opcode) && contains(spec.ranges, info.opcode),
    ).map((info) => info.mnemonic);
    if (mnemonics.length > 0) {
      families.push({ name: spec.name, mnemonics });
    }
  }
  return families;
}

export function featureGaps(): readonly FeatureGap[] {
  const gaps: FeatureGap[] = [];
  for (const spec of FEATURES) {
    const missing = spec.requires.filter((mnemonic) => !isExecutableMnemonic(mnemonic));
    if (missing.length > 0) {
      gaps.push({ title: spec.title, missing });
    }
  }
  return gaps;
}

export function capabilitySummary(): CapabilitySummary {
  return {
    executable: ASSIGNED.filter((info) => EXECUTABLE_OPCODES.has(info.opcode)).length,
    assigned: ASSIGNED.filter((info) => info.kind !== 'reserved').length,
    families: executableFamilies(),
    gaps: featureGaps(),
  };
}
