/// <reference types="node" />

import { readFileSync } from 'node:fs';

export interface JavapSwitchCase {
  readonly match: number | undefined;
  readonly target: number;
}

export interface JavapInstruction {
  readonly offset: number;
  readonly mnemonic: string;
  readonly operandText: string;
  readonly comment: string;
  readonly switchCases: readonly JavapSwitchCase[];
}

export interface JavapMethod {
  readonly signature: string;
  readonly instructions: readonly JavapInstruction[];
}

const INSTRUCTION = /^\s+(\d+):\s+([a-z][a-z0-9_]*)\s*(.*)$/;
const METHOD_HEADER = /^\s{2}(\S.*);\s*$/;
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

export function javapMethod(methods: readonly JavapMethod[], signature: string): JavapMethod {
  const method = methods.find((candidate) => candidate.signature === signature);
  if (method === undefined) {
    const known = methods.map((candidate) => candidate.signature).join(', ');
    throw new Error(`javap dump has no method "${signature}" (it has: ${known})`);
  }
  return method;
}
