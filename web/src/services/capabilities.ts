/**
 * What this machine can actually run, stated before anyone hands it a file.
 *
 * The interpreter implements a narrow subset of the instruction set, so a `.class` file taken
 * from a real project usually stops on an instruction nobody here executes. Saying that on the
 * welcome screen is only honest if the statement cannot drift, so nothing below is written out
 * by hand: the families are the opcode table intersected with the interpreter's executable set,
 * and a missing Java feature is missing because the instructions it compiles down to are absent
 * from that set. An instruction that gains an implementation joins its family and disappears
 * from the gap list without anyone editing this file.
 */

import { OPCODES, type OpcodeInfo } from '../core/disassembler';
import { EXECUTABLE_OPCODES } from '../core/interpreter';

export interface InstructionFamily {
  readonly name: string;
  /** The mnemonics of this family the interpreter can run, in opcode order. */
  readonly mnemonics: readonly string[];
}

export interface FeatureGap {
  /** Named as a Java programmer meets it, not as an opcode. */
  readonly title: string;
  /** The instructions it still needs — the list shrinks as implementations land. */
  readonly missing: readonly string[];
}

export interface CapabilitySummary {
  /** Assigned opcodes the interpreter executes. */
  readonly executable: number;
  /** Assigned opcodes that a compiler can emit — the reserved three are not among them. */
  readonly assigned: number;
  readonly families: readonly InstructionFamily[];
  readonly gaps: readonly FeatureGap[];
}

/**
 * The one restriction no opcode can express: `invokestatic` is executable, but the interpreter
 * resolves it against the uploaded class alone and rejects any other target, so there is no
 * standard library behind it. Kept here next to the derived facts, and marked as asserted.
 */
export const CALL_SCOPE_NOTE =
  'Calls resolve inside the uploaded class only — static methods taking and returning int, with no standard library behind them.';

/** Inclusive, as the JVMS tables are written. */
type OpcodeRange = readonly [first: number, last: number];

interface FamilySpec {
  readonly name: string;
  readonly ranges: readonly OpcodeRange[];
}

/**
 * JVMS §6.5 lays the instruction set out in blocks — constants, then loads, then stores, and
 * so on — so a family is a set of opcode ranges rather than a list of mnemonics. An opcode
 * that becomes executable joins its family by its own byte value, with nothing to update here.
 *
 * Between them the ranges cover every assigned opcode except the three reserved for JVM
 * internals (JVMS §6.2), which no class file may contain.
 */
const FAMILIES: readonly FamilySpec[] = [
  { name: 'Constants', ranges: [[0x00, 0x14]] },
  // 0xc4 `wide` belongs here: all it does is widen the local index of a load or a store.
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
  /** Every instruction the feature needs; the feature works only once all of them run. */
  readonly requires: readonly string[];
}

/**
 * The editorial half: which absences a Java programmer will actually notice, ordered by how
 * soon they bite. Only the naming is a judgement call — whether an entry appears at all, and
 * which instructions it still names, comes from the executable set.
 */
const FEATURES: readonly FeatureSpec[] = [
  { title: 'Printing to the console', requires: ['getstatic', 'invokevirtual'] },
  { title: 'Objects, constructors and instance methods', requires: ['new', 'invokespecial'] },
  { title: 'String literals and other pooled constants', requires: ['ldc'] },
  { title: 'long, float and double values', requires: ['ladd', 'fadd', 'dadd'] },
  { title: 'Exceptions, throw and try/catch', requires: ['athrow'] },
  { title: 'switch statements', requires: ['tableswitch', 'lookupswitch'] },
  { title: 'Bitwise operators and shifts', requires: ['iand', 'ior', 'ixor', 'ishl', 'ishr'] },
  {
    title: 'Interfaces, lambdas and method references',
    requires: ['invokeinterface', 'invokedynamic'],
  },
  { title: 'Fields — any state outside a local slot', requires: ['getfield', 'putfield'] },
  { title: 'Arrays of anything but int', requires: ['anewarray', 'aaload', 'baload', 'caload'] },
];

/** Ascending by opcode, so every list built from it reads in the order of the JVMS tables. */
const ASSIGNED: readonly OpcodeInfo[] = [...OPCODES.values()].sort((a, b) => a.opcode - b.opcode);

const MNEMONIC_TO_OPCODE: ReadonlyMap<string, number> = new Map(
  ASSIGNED.map((info) => [info.mnemonic, info.opcode]),
);

function contains(ranges: readonly OpcodeRange[], opcode: number): boolean {
  return ranges.some(([first, last]) => opcode >= first && opcode <= last);
}

/** False for an unassigned byte and for a mnemonic no longer in the table. */
export function isExecutableMnemonic(mnemonic: string): boolean {
  const opcode = MNEMONIC_TO_OPCODE.get(mnemonic);
  return opcode !== undefined && EXECUTABLE_OPCODES.has(opcode);
}

/** Families with nothing executable in them are dropped rather than shown as empty rows. */
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
