/**
 * A reader for the committed `javap` dumps, so parity with the reference disassembler is a
 * comparison against a file the JDK wrote rather than a listing someone transcribed by hand.
 *
 * Both dump flavours parse the same way: a method header is an indented line ending with a
 * semicolon, and an instruction is `<offset>: <mnemonic> [operands] [// comment]`. Everything
 * else javap prints — constant pool, tables — never matches either shape.
 *
 * A switch is the one instruction javap spreads over several lines: the mnemonic opens a
 * `{ … }` block and each arm sits on a line of its own. Those lines are collected into
 * `switchCases`, so the decoded jump table is compared against javap's rather than against a
 * table someone typed out from the class file.
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';

export interface JavapSwitchCase {
  /** `undefined` for the `default:` line. */
  readonly match: number | undefined;
  readonly target: number;
}

export interface JavapInstruction {
  readonly offset: number;
  readonly mnemonic: string;
  /** What javap printed after the mnemonic, comment stripped: `#7`, `10`, `int`, `#33,  2`. */
  readonly operandText: string;
  /** The trailing `// …` javap adds for constant pool references; empty when there is none. */
  readonly comment: string;
  /** Arms of a `tableswitch`/`lookupswitch`, in the order javap lists them; else empty. */
  readonly switchCases: readonly JavapSwitchCase[];
}

export interface JavapMethod {
  /** As javap prints it, e.g. `static int factorial(int)`. */
  readonly signature: string;
  readonly instructions: readonly JavapInstruction[];
}

const INSTRUCTION = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/;
const METHOD_HEADER = /^\s{2}(\S.*);\s*$/;
/** A switch arm: `           500: 38`, and `         default: 42`. */
const SWITCH_CASE = /^\s*(-?\d+|default):\s*(\d+)\s*$/;

interface MutableInstruction {
  offset: number;
  mnemonic: string;
  operandText: string;
  comment: string;
  switchCases: JavapSwitchCase[];
}

export function parseJavap(dump: string): readonly JavapMethod[] {
  const methods: { signature: string; instructions: MutableInstruction[] }[] = [];
  /** The switch whose `{ … }` block is currently open, if any. */
  let openSwitch: MutableInstruction | undefined;

  for (const line of dump.split('\n')) {
    if (openSwitch !== undefined) {
      const arm = SWITCH_CASE.exec(line);
      if (arm !== null) {
        openSwitch.switchCases.push({
          match: arm[1] === 'default' ? undefined : Number(arm[1]),
          target: Number(arm[2]),
        });
        continue;
      }
      if (line.includes('}')) {
        openSwitch = undefined;
        continue;
      }
    }

    const instruction = INSTRUCTION.exec(line);
    if (instruction !== null) {
      const current = methods.at(-1);
      if (current === undefined) {
        throw new Error(`javap dump has an instruction before any method: "${line.trim()}"`);
      }
      const rest = instruction[3] ?? '';
      const commentAt = rest.indexOf('//');
      const decoded: MutableInstruction = {
        offset: Number(instruction[1]),
        mnemonic: instruction[2] ?? '',
        operandText: (commentAt === -1 ? rest : rest.slice(0, commentAt)).trim(),
        comment: commentAt === -1 ? '' : rest.slice(commentAt + 2).trim(),
        switchCases: [],
      };
      current.instructions.push(decoded);
      if (decoded.operandText.startsWith('{')) {
        // The operand text of a switch is the `{` that opens its table, not an operand.
        decoded.operandText = '';
        openSwitch = decoded;
      }
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
