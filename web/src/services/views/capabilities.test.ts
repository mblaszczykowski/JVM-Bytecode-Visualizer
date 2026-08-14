import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSupportedOpcode, OPCODES } from '../../core/disassembler';
import { EXECUTABLE_OPCODES } from '../../core/interpreter';
import type * as Interpreter from '../../core/interpreter';

import {
  CALL_SCOPE_NOTE,
  capabilitySummary,
  executableFamilies,
  featureGaps,
  isExecutableMnemonic,
} from './capabilities';
import type * as Capabilities from './capabilities';

function executableMnemonics(): readonly string[] {
  return [...OPCODES.values()]
    .filter((info) => EXECUTABLE_OPCODES.has(info.opcode))
    .map((info) => info.mnemonic);
}

async function capabilitiesWith(...opcodes: readonly number[]): Promise<typeof Capabilities> {
  const actual = await vi.importActual<typeof Interpreter>('../../core/interpreter');
  vi.doMock('../../core/interpreter', () => ({
    ...actual,
    EXECUTABLE_OPCODES: new Set([...actual.EXECUTABLE_OPCODES, ...opcodes]),
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

  it('follows the interpreter into an instruction it has just learned', async () => {
    const putstatic = 0xb3;
    expect(EXECUTABLE_OPCODES.has(putstatic)).toBe(false);

    const widened = await capabilitiesWith(putstatic);

    const fields = widened.executableFamilies().find((family) => family.name === 'Field access');
    const statics = widened
      .featureGaps()
      .find((gap) => gap.title === 'Static fields: state that outlives every instance');

    expect(fields?.mnemonics).toContain('putstatic');
    expect(statics).toBeUndefined();
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

  it('still reports the absences a real class file keeps hitting', () => {
    const titles = featureGaps().map((gap) => gap.title);

    expect(titles).toContain('Interfaces, lambdas and method references');
    expect(titles).toContain('long, float and double values');
  });

  it('drops a feature once every instruction behind it runs', async () => {
    const [invokeinterface, invokedynamic] = [0xb9, 0xba];
    const widened = await capabilitiesWith(invokeinterface, invokedynamic);
    const title = 'Interfaces, lambdas and method references';

    expect(featureGaps().map((gap) => gap.title)).toContain(title);
    expect(widened.featureGaps().map((gap) => gap.title)).not.toContain(title);
  });

  it('leaves objects out of the gap list, because the instructions behind them run', () => {
    const titles = featureGaps().map((gap) => gap.title);

    for (const mnemonic of ['new', 'invokespecial', 'invokevirtual', 'getfield', 'putfield']) {
      expect(isExecutableMnemonic(mnemonic)).toBe(true);
    }
    expect(titles).not.toContain('Objects, constructors and instance methods');
    expect(titles).not.toContain('Exceptions, throw and try/catch');
    expect(CALL_SCOPE_NOTE).toContain('must resolve inside the loaded class');
  });

  it('names the standard-library slice the note claims, rather than denying it', () => {
    for (const mnemonic of ['getstatic', 'invokevirtual', 'invokestatic']) {
      expect(isExecutableMnemonic(mnemonic)).toBe(true);
    }

    expect(featureGaps().map((gap) => gap.title)).not.toContain('Printing to the console');
    expect(CALL_SCOPE_NOTE).toContain('System.out');
    expect(CALL_SCOPE_NOTE).toContain('Math');
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

  it('never claims to execute an instruction the disassembler cannot decode', () => {
    for (const opcode of EXECUTABLE_OPCODES) {
      expect(isSupportedOpcode(opcode)).toBe(true);
    }
  });
});
