import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { OPCODES } from '../core/disassembler';
import type { Snapshot } from '../core/interpreter';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';

import {
  readExampleBytes,
  readExampleManifest,
  readExampleText,
} from './__fixtures__/example-files';
import { describeNextInstruction } from './derivations';
import { parseExampleManifest } from './manifest';
import { buildProgram, listingFor, type LoadedProgram } from './program';

const ARITHMETIC = /and pushes (-?\d+) (\S+) (-?\d+) = (-?\d+)\.$/;
const BRANCH_TAKEN = /: true, so execution jumps to pc (\d+)\.$/;
const BRANCH_NOT_TAKEN = /: false, so execution falls through to pc (\d+)\.$/;
const CALL = /callee starts at pc 0 and (\S+) resumes at pc (\d+)\.$/;

const SYMBOLS: Readonly<Record<string, string>> = {
  '+': 'iadd',
  '−': 'isub',
  '×': 'imul',
  '÷': 'idiv',
  mod: 'irem',
  '<<': 'ishl',
  '>>': 'ishr',
  '>>>': 'iushr',
  '&': 'iand',
  '|': 'ior',
  '^': 'ixor',
};

function loadExample(classFile: string, sourceFile: string): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName: classFile },
    classFile: parseClassFile(readExampleBytes(classFile)),
    source: { fileName: sourceFile, text: readExampleText(sourceFile) },
  });
}

function explanationOf(program: LoadedProgram, snapshot: Snapshot): string {
  return (
    describeNextInstruction(snapshot, listingFor(program, snapshot), program.classFile)
      ?.explanation ?? ''
  );
}

function isBranchDecision(explanation: string): boolean {
  return BRANCH_TAKEN.test(explanation) || BRANCH_NOT_TAKEN.test(explanation);
}

interface Checked {
  readonly arithmetic: number;
  readonly branches: number;
  readonly calls: number;
  readonly mnemonics: ReadonlySet<string>;
}

function checkAgainstTheRun(program: LoadedProgram): Checked {
  let arithmetic = 0;
  let branches = 0;
  let calls = 0;
  const mnemonics = new Set<string>();

  program.snapshots.forEach((snapshot, index) => {
    const explanation = explanationOf(program, snapshot);
    const next = program.snapshots[index + 1];
    if (explanation === '' || next === undefined) {
      return;
    }
    const said = `step ${String(index)}: ${explanation}`;
    const stack = snapshot.callStack.at(-1)?.operandStack ?? [];
    const top = next.callStack.at(-1);
    const mnemonic = snapshot.currentInstruction?.mnemonic ?? '';

    const sum = ARITHMETIC.exec(explanation);
    if (sum !== null) {
      const [, left, symbol, right, result] = sum;
      expect(SYMBOLS[symbol ?? ''], said).toBe(mnemonic);
      expect(Number(left), said).toBe(stack.at(-2));
      expect(Number(right), said).toBe(stack.at(-1));
      expect(top?.operandStack.at(-1), said).toBe(Number(result));
      mnemonics.add(mnemonic);
      arithmetic += 1;
    }

    const branch = BRANCH_TAKEN.exec(explanation) ?? BRANCH_NOT_TAKEN.exec(explanation);
    if (branch !== null) {
      expect(top?.pc, said).toBe(Number(branch[1]));
      mnemonics.add(mnemonic);
      branches += 1;
    }

    const call = CALL.exec(explanation);
    if (call !== null) {
      expect(top?.pc, said).toBe(0);
      expect(next.callStack.at(-2)?.methodName, said).toBe(call[1]);
      expect(next.callStack.at(-2)?.pc, said).toBe(Number(call[2]));
      mnemonics.add(mnemonic);
      calls += 1;
    }
  });

  return { arithmetic, branches, calls, mnemonics };
}

const COMPARISONS = [
  'ifeq',
  'ifne',
  'iflt',
  'ifge',
  'ifgt',
  'ifle',
  'if_icmpeq',
  'if_icmpne',
  'if_icmplt',
  'if_icmpge',
  'if_icmple',
  'if_icmpgt',
];

const PROBE_VALUES = [3, 0, -1];
const PROBE_PAIRS: readonly (readonly [number, number])[] = [
  [3, 3],
  [1, 2],
  [2, 1],
];

function opcodeOf(mnemonic: string): number {
  const info = [...OPCODES.values()].find((candidate) => candidate.mnemonic === mnemonic);
  if (info === undefined) {
    throw new Error(`no opcode is named ${mnemonic}`);
  }
  return info.opcode;
}

const NOP = opcodeOf('nop');
const OVER_THE_NOPS = 6;

function push(value: number): readonly number[] {
  return [opcodeOf('bipush'), value & 0xff];
}

function branchOverThreeNops(mnemonic: string): readonly number[] {
  return [opcodeOf(mnemonic), 0x00, OVER_THE_NOPS, NOP, NOP, NOP];
}

function everyOperator(): LoadedProgram {
  const code: number[] = [];

  for (const mnemonic of Object.values(SYMBOLS)) {
    code.push(...push(7), ...push(3), opcodeOf(mnemonic), opcodeOf('pop'));
  }
  for (const mnemonic of COMPARISONS) {
    const operands = mnemonic.startsWith('if_icmp')
      ? PROBE_PAIRS.map((pair) => [...push(pair[0]), ...push(pair[1])])
      : PROBE_VALUES.map((value) => [...push(value)]);
    for (const pushes of operands) {
      code.push(...pushes, ...branchOverThreeNops(mnemonic));
    }
  }
  code.push(opcodeOf('return'));

  return buildProgram({
    origin: { kind: 'upload', fileName: 'Operators.class' },
    classFile: syntheticClass({
      methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code }],
    }),
  });
}

describe('what the panels explain matches what the interpreter does', () => {
  const { examples } = parseExampleManifest(readExampleManifest());

  it.each(examples)(
    '$id keeps its explanations true, step for step',
    ({ classFile, sourceFile }) => {
      const checked = checkAgainstTheRun(loadExample(classFile, sourceFile));

      expect(checked.arithmetic).toBeGreaterThan(0);
      expect(checked.branches).toBeGreaterThan(0);
      expect(checked.calls).toBeGreaterThan(0);
    },
  );

  it('checks the operators the bundled examples never reach', () => {
    const checked = checkAgainstTheRun(everyOperator());

    expect([...checked.mnemonics].sort()).toEqual(
      [...Object.values(SYMBOLS), ...COMPARISONS].sort(),
    );
  });

  it('follows the loops far enough to be worth the name', () => {
    const branchesIn = (classFile: string, sourceFile: string): number => {
      const program = loadExample(classFile, sourceFile);
      return program.snapshots.filter((snapshot) =>
        isBranchDecision(explanationOf(program, snapshot)),
      ).length;
    };

    expect(branchesIn('Gcd.class', 'Gcd.java')).toBe(4);
    expect(branchesIn('SumOfProducts.class', 'SumOfProducts.java')).toBeGreaterThan(40);
  });
});
