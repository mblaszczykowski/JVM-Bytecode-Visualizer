import { describe, expect, it } from 'vitest';

import { OPCODES, WIDENED_FORMS } from '../src/core/disassembler/opcodes';
import { EXTERNAL_FIELDS, EXTERNAL_METHODS } from '../src/core/interpreter/externals';
import {
  ALLOWED_MNEMONICS,
  EXTERNAL_MEMBERS,
  SUPPORTED_INSTRUCTION_SET,
} from './build-fixtures.mjs';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe('the example builder and the interpreter agree on the supported subset', () => {
  it('allows exactly the opcodes the disassembler gives a stack effect to', () => {
    const executed = [...OPCODES.values()]
      .filter((info) => info.kind === 'supported')
      .map((info) => info.mnemonic);
    const widened = [...WIDENED_FORMS.values()]
      .filter((form) => !form.unsupported)
      .map((form) => form.mnemonic);

    expect(sorted(ALLOWED_MNEMONICS)).toEqual(sorted([...executed, ...widened]));
  });

  it('lists every allowed mnemonic in exactly one family', () => {
    const listed = Object.values(SUPPORTED_INSTRUCTION_SET).flat();

    expect(sorted(listed)).toEqual(sorted(ALLOWED_MNEMONICS));
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('allows exactly the standard library members the interpreter implements', () => {
    expect(sorted(EXTERNAL_MEMBERS)).toEqual(
      sorted([...EXTERNAL_FIELDS.keys(), ...EXTERNAL_METHODS.keys()]),
    );
  });
});
