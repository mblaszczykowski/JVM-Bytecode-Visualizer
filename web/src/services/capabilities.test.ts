import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSupportedOpcode, OPCODES } from '../core/disassembler';
import { EXECUTABLE_OPCODES } from '../core/interpreter';
import type * as Interpreter from '../core/interpreter';

import {
  capabilitySummary,
  executableFamilies,
  featureGaps,
  isExecutableMnemonic,
} from './capabilities';
import type * as Capabilities from './capabilities';

/** The mnemonics the interpreter can run, straight from the two sources of truth. */
function executableMnemonics(): readonly string[] {
  return [...OPCODES.values()]
    .filter((info) => EXECUTABLE_OPCODES.has(info.opcode))
    .map((info) => info.mnemonic);
}

/**
 * Re-imports the module against an interpreter that executes one more opcode — the cheapest
 * stand-in for the work landing next door, and the only way to prove the lists are derived
 * rather than merely correct today.
 */
async function capabilitiesWith(opcode: number): Promise<typeof Capabilities> {
  const actual = await vi.importActual<typeof Interpreter>('../core/interpreter');
  vi.doMock('../core/interpreter', () => ({
    ...actual,
    EXECUTABLE_OPCODES: new Set([...actual.EXECUTABLE_OPCODES, opcode]),
  }));
  return import('./capabilities');
}

afterEach(() => {
  vi.doUnmock('../core/interpreter');
  vi.resetModules();
});

describe('instruction families', () => {
  it('places every executable instruction in exactly one family', () => {
    const grouped = executableFamilies().flatMap((family) => family.mnemonics);

    expect([...grouped].sort()).toEqual([...executableMnemonics()].sort());
  });

  it('names only instructions the interpreter can actually run', () => {
    for (const family of executableFamilies()) {
      expect(family.mnemonics.length).toBeGreaterThan(0);
      for (const mnemonic of family.mnemonics) {
        expect(isExecutableMnemonic(mnemonic)).toBe(true);
      }
    }
  });

  it('lists each family in the opcode order of the JVMS tables', () => {
    for (const family of executableFamilies()) {
      const opcodes = family.mnemonics.map(
        (mnemonic) =>
          [...OPCODES.values()].find((info) => info.mnemonic === mnemonic)?.opcode ?? -1,
      );

      expect(opcodes).toEqual([...opcodes].sort((a, b) => a - b));
    }
  });

  /**
   * The point of the whole module: the other half of the project is widening the instruction
   * set, and nothing here may need a hand-edit when it lands. Widening the executable set by
   * one opcode has to move that opcode into its family and out of the gap that named it.
   */
  it('follows the interpreter into an instruction it has just learned', async () => {
    const getstatic = 0xb2;
    expect(EXECUTABLE_OPCODES.has(getstatic)).toBe(false);

    const widened = await capabilitiesWith(getstatic);

    const fields = widened.executableFamilies().find((family) => family.name === 'Field access');
    const printing = widened.featureGaps().find((gap) => gap.title === 'Printing to the console');

    expect(fields?.mnemonics).toEqual(['getstatic']);
    expect(printing?.missing).toEqual(['invokevirtual']);
    expect(widened.capabilitySummary().executable).toBe(capabilitySummary().executable + 1);
  });
});

describe('feature gaps', () => {
  it('names real instructions that the interpreter refuses', () => {
    const known = new Set([...OPCODES.values()].map((info) => info.mnemonic));

    for (const gap of featureGaps()) {
      expect(gap.missing.length).toBeGreaterThan(0);
      for (const mnemonic of gap.missing) {
        expect(known).toContain(mnemonic);
        expect(isExecutableMnemonic(mnemonic)).toBe(false);
      }
    }
  });

  it('still reports the absences the empirical probe kept hitting', () => {
    const titles = featureGaps().map((gap) => gap.title);

    expect(titles).toContain('Printing to the console');
    expect(titles).toContain('Objects, constructors and instance methods');
  });

  it('drops a feature once every instruction behind it runs', async () => {
    const ldc = 0x12;
    const widened = await capabilitiesWith(ldc);

    expect(featureGaps().map((gap) => gap.title)).toContain(
      'String literals and other pooled constants',
    );
    expect(widened.featureGaps().map((gap) => gap.title)).not.toContain(
      'String literals and other pooled constants',
    );
  });
});

describe('isExecutableMnemonic', () => {
  it('answers for an instruction the interpreter runs', () => {
    expect(isExecutableMnemonic('iadd')).toBe(true);
  });

  it('answers for an assigned instruction it does not', () => {
    expect(isExecutableMnemonic('invokedynamic')).toBe(false);
  });

  it('is false for a name that is not an instruction at all', () => {
    expect(isExecutableMnemonic('iadd2')).toBe(false);
  });
});

describe('capabilitySummary', () => {
  it('counts a real subset of the instruction set', () => {
    const summary = capabilitySummary();

    expect(summary.executable).toBeGreaterThan(0);
    expect(summary.executable).toBeLessThan(summary.assigned);
  });

  it('counts the instructions a compiler may emit, so without the reserved three', () => {
    const reserved = [...OPCODES.values()].filter((info) => info.kind === 'reserved');

    expect(reserved).toHaveLength(3);
    expect(capabilitySummary().assigned).toBe(OPCODES.size - reserved.length);
  });

  it('counts exactly what the families list', () => {
    const summary = capabilitySummary();

    expect(summary.families.flatMap((family) => family.mnemonics)).toHaveLength(summary.executable);
  });

  /**
   * Executing an instruction the disassembler cannot decode is unreachable by construction —
   * a divergence between the two tables would show up here before it showed up in a run.
   */
  it('never claims to execute an instruction the disassembler cannot decode', () => {
    for (const opcode of EXECUTABLE_OPCODES) {
      expect(isSupportedOpcode(opcode)).toBe(true);
    }
  });
});
