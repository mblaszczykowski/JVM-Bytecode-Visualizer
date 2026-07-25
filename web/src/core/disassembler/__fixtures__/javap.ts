/**
 * A reader for the committed `javap` dumps, so parity with the reference disassembler is a
 * comparison against a file the JDK wrote rather than a listing someone transcribed by hand.
 *
 * Both dump flavours parse the same way: a method header is an indented line ending with a
 * semicolon, and an instruction is `<offset>: <mnemonic> [operands] [// comment]`. Everything
 * else javap prints — constant pool, tables, switch case labels — never matches either shape.
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';

export interface JavapInstruction {
  readonly offset: number;
  readonly mnemonic: string;
  /** What javap printed after the mnemonic, comment stripped: `#7`, `10`, `int`, `#33,  2`. */
  readonly operandText: string;
  /** The trailing `// …` javap adds for constant pool references; empty when there is none. */
  readonly comment: string;
}

export interface JavapMethod {
  /** As javap prints it, e.g. `static int factorial(int)`. */
  readonly signature: string;
  readonly instructions: readonly JavapInstruction[];
}

const INSTRUCTION = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/;
const METHOD_HEADER = /^\s{2}(\S.*);\s*$/;

export function parseJavap(dump: string): readonly JavapMethod[] {
  const methods: { signature: string; instructions: JavapInstruction[] }[] = [];

  for (const line of dump.split('\n')) {
    const instruction = INSTRUCTION.exec(line);
    if (instruction !== null) {
      const current = methods.at(-1);
      if (current === undefined) {
        throw new Error(`javap dump has an instruction before any method: "${line.trim()}"`);
      }
      const rest = instruction[3] ?? '';
      const commentAt = rest.indexOf('//');
      current.instructions.push({
        offset: Number(instruction[1]),
        mnemonic: instruction[2] ?? '',
        operandText: (commentAt === -1 ? rest : rest.slice(0, commentAt)).trim(),
        comment: commentAt === -1 ? '' : rest.slice(commentAt + 2).trim(),
      });
      continue;
    }

    const header = METHOD_HEADER.exec(line);
    if (header !== null) {
      methods.push({ signature: (header[1] ?? '').trim(), instructions: [] });
    }
  }

  return methods;
}

export function readJavap(dump: URL): readonly JavapMethod[] {
  return parseJavap(readFileSync(dump, 'utf8'));
}

/** One method of a dump, by the signature javap printed for it. */
export function javapMethod(methods: readonly JavapMethod[], signature: string): JavapMethod {
  const method = methods.find((candidate) => candidate.signature === signature);
  if (method === undefined) {
    const known = methods.map((candidate) => candidate.signature).join(', ');
    throw new Error(`javap dump has no method "${signature}" (it has: ${known})`);
  }
  return method;
}
