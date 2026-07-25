/**
 * The teaching text against the engine, on every snapshot of all four bundled examples.
 *
 * `describeNextInstruction` states what is about to happen in words and numbers — "pushes
 * 6 × 4 = 24", "true, so execution jumps to pc 7", "the callee starts at pc 0 and main
 * resumes at pc 4". Each of those is a prediction, and the next snapshot is the answer, so
 * every sentence can be held against what the interpreter actually did.
 *
 * The examples the other derivation tests never touch are the point here: the loops in Gcd
 * and SumOfProducts produce hundreds of predictions that nothing else checks.
 */

import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import type { Snapshot } from '../core/interpreter';

import {
  readExampleBytes,
  readExampleManifest,
  readExampleText,
} from './__fixtures__/example-files';
import { describeNextInstruction } from './derivations';
import { parseExampleManifest } from './manifest';
import { buildProgram, listingFor, type LoadedProgram } from './program';

/** `Pops 4 and 6 and pushes 6 × 4 = 24.` — both operands, the symbol and the result. */
const ARITHMETIC = /and pushes (-?\d+) (\S+) (-?\d+) = (-?\d+)\.$/;
const BRANCH_TAKEN = /— true, so execution jumps to pc (\d+)\.$/;
const BRANCH_NOT_TAKEN = /— false, so execution falls through to pc (\d+)\.$/;
const CALL = /the callee starts at pc 0 and (\S+) resumes at pc (\d+)\.$/;

/** The symbol the sentence uses has to belong to the instruction that is about to run. */
const SYMBOLS: Readonly<Record<string, string>> = {
  '+': 'iadd',
  '−': 'isub',
  '×': 'imul',
  '÷': 'idiv',
  mod: 'irem',
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

describe('what the panels explain matches what the interpreter does', () => {
  const { examples } = parseExampleManifest(readExampleManifest());

  it.each(examples)(
    '$id keeps its explanations true, step for step',
    ({ classFile, sourceFile }) => {
      const program = loadExample(classFile, sourceFile);
      let arithmetic = 0;
      let branches = 0;
      let calls = 0;

      program.snapshots.forEach((snapshot, index) => {
        const explanation = explanationOf(program, snapshot);
        const next = program.snapshots[index + 1];
        if (explanation === '' || next === undefined) {
          return;
        }
        // Every assertion carries the sentence it is about — a bare `2 !== 3` on step 417 of
        // SumOfProducts says nothing.
        const said = `step ${String(index)}: ${explanation}`;
        const stack = snapshot.callStack.at(-1)?.operandStack ?? [];
        const top = next.callStack.at(-1);

        const sum = ARITHMETIC.exec(explanation);
        if (sum !== null) {
          const [, left, symbol, right, result] = sum;
          expect(SYMBOLS[symbol ?? ''], said).toBe(snapshot.currentInstruction?.mnemonic);
          expect(Number(left), said).toBe(stack.at(-2));
          expect(Number(right), said).toBe(stack.at(-1));
          expect(top?.operandStack.at(-1), said).toBe(Number(result));
          arithmetic += 1;
        }

        const branch = BRANCH_TAKEN.exec(explanation) ?? BRANCH_NOT_TAKEN.exec(explanation);
        if (branch !== null) {
          expect(top?.pc, said).toBe(Number(branch[1]));
          branches += 1;
        }

        const call = CALL.exec(explanation);
        if (call !== null) {
          expect(top?.pc, said).toBe(0);
          expect(next.callStack.at(-2)?.methodName, said).toBe(call[1]);
          expect(next.callStack.at(-2)?.pc, said).toBe(Number(call[2]));
          calls += 1;
        }
      });

      // A sentence that changed shape would leave every assertion above unreached.
      expect(arithmetic).toBeGreaterThan(0);
      expect(branches).toBeGreaterThan(0);
      expect(calls).toBeGreaterThan(0);
    },
  );

  it('follows the loops far enough to be worth the name', () => {
    const branchesIn = (classFile: string, sourceFile: string): number => {
      const program = loadExample(classFile, sourceFile);
      return program.snapshots.filter((snapshot) =>
        isBranchDecision(explanationOf(program, snapshot)),
      ).length;
    };

    // Euclid's loop tests its condition four times; the 6×6 grid tests its own dozens of times.
    expect(branchesIn('Gcd.class', 'Gcd.java')).toBe(4);
    expect(branchesIn('SumOfProducts.class', 'SumOfProducts.java')).toBeGreaterThan(40);
  });
});
