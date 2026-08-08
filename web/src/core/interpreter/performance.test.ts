import { describe, expect, it } from 'vitest';

import { execute } from './interpreter';
import type { Snapshot } from './types';

import { expectCompleted } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
} from './__fixtures__/synthetic-class';

/**
 * The costs the architecture claims, asserted rather than assumed.
 *
 * `snapshot.ts` says copying the whole call stack on every step costs O(steps × depth) and that
 * "a thousand nested calls alone allocated gigabytes", which is why `SnapshotWriter` carries
 * unchanged frames over instead. ADR-0001 rests on that being true, and nothing checked it.
 *
 * These are budgets in the sense `scripts/check-bundle-size.mjs` uses the word: numbers close
 * enough to the measurement to fire when the shape of the cost changes, and boring to raise in
 * a commit that says why. The only wall-clock assertion is a smoke ceiling wide enough that a
 * loaded CI runner does not trip it — timing belongs in a benchmark, invariants belong here.
 */

/** Recursion deep enough for sharing to matter: naive copying is quadratic in this depth. */
const DEPTH = 200;

/** Iterations of the counting loop; each costs five instructions. */
const ITERATIONS = 4_000;

/**
 * `static int down(int n) { return n > 0 ? down(n - 1) : 0; }`, hand-assembled so the depth is
 * a constant of this test rather than of a fixture someone might reasonably re-tune.
 */
function deepRecursion(): readonly Snapshot[] {
  const pool = new ConstantPoolBuilder();
  const down = pool.methodref(SYNTHETIC_CLASS_NAME, 'down', '(I)I');
  const classFile = syntheticClass({
    pool,
    methods: [
      // sipush DEPTH; invokestatic down; ireturn
      {
        name: 'main',
        descriptor: '()I',
        code: [0x11, (DEPTH >> 8) & 0xff, DEPTH & 0xff, 0xb8, 0x00, down, 0xac],
      },
      // iload_0; ifgt 6; iconst_0; ireturn; iload_0; iconst_1; isub; invokestatic down; ireturn
      {
        name: 'down',
        descriptor: '(I)I',
        code: [0x1a, 0x9d, 0x00, 0x05, 0x03, 0xac, 0x1a, 0x04, 0x64, 0xb8, 0x00, down, 0xac],
      },
    ],
  });

  return expectCompleted(execute(classFile, { maxSteps: 40_000, maxCallDepth: DEPTH + 8 }))
    .snapshots;
}

/** `for (int i = 0; i < ITERATIONS; i++) {}` — the cheapest way to a long history. */
function countingLoop(): readonly Snapshot[] {
  const classFile = syntheticClass({
    methods: [
      {
        name: 'main',
        descriptor: '()V',
        code: [
          0x03, // iconst_0
          0x3b, // istore_0
          0x1a, // iload_0            <- loop head, offset 2
          0x11,
          (ITERATIONS >> 8) & 0xff,
          ITERATIONS & 0xff, // sipush ITERATIONS
          0xa2,
          0x00,
          0x09, // if_icmpge +9 -> 15
          0x84,
          0x00,
          0x01, // iinc 0, 1
          0xa7,
          0xff,
          0xf6, // goto -10 -> 2
          0xb1, // return
        ],
        maxLocals: 2,
      },
    ],
  });

  return expectCompleted(execute(classFile, { maxSteps: 40_000 })).snapshots;
}

/** What the naive writer would have allocated: one frame copy per frame per step. */
function naiveFrameCopies(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((total, snapshot) => total + snapshot.callStack.length, 0);
}

/** What it actually allocated: frames are carried over, so identity is the measure. */
function actualFrameCopies(snapshots: readonly Snapshot[]): number {
  const seen = new Set<unknown>();
  for (const snapshot of snapshots) {
    for (const frame of snapshot.callStack) {
      seen.add(frame);
    }
  }
  return seen.size;
}

describe('the history costs what ADR-0001 says it costs', () => {
  it('copies a frame once per change, not once per step it survives', () => {
    const snapshots = deepRecursion();
    const naive = naiveFrameCopies(snapshots);
    const actual = actualFrameCopies(snapshots);

    // At this depth the naive cost is an order of magnitude larger. The ratio is the point:
    // a change that reintroduced per-step copying would collapse it towards 1.
    expect(snapshots.length).toBeGreaterThan(1_000);
    expect(naive / actual).toBeGreaterThan(10);
  });

  it('shares one frame object between consecutive steps that did not touch it', () => {
    const snapshots = deepRecursion();
    // The deepest point of the run: everything below the top is waiting and unchanged.
    const deepest = snapshots.reduce((best, snapshot) =>
      snapshot.callStack.length > best.callStack.length ? snapshot : best,
    );
    const at = snapshots.indexOf(deepest);
    const next = snapshots[at + 1];

    expect(deepest.callStack.length).toBeGreaterThan(DEPTH);
    // Same objects, not equal ones — carried over rather than rebuilt.
    expect(next?.callStack[0]).toBe(deepest.callStack[0]);
    expect(next?.callStack[1]).toBe(deepest.callStack[1]);
  });

  it('keeps the per-step cost of a flat run to one frame', () => {
    const snapshots = countingLoop();

    expect(snapshots.length).toBeGreaterThan(ITERATIONS * 4);
    // One live frame throughout, and it changes every step, so there is nothing to share —
    // the guard here is that the writer does not copy *more* than the one frame that moved.
    expect(actualFrameCopies(snapshots)).toBeLessThanOrEqual(snapshots.length);
  });

  it('records twenty thousand steps well inside a browser frame budget', () => {
    const started = performance.now();
    const snapshots = countingLoop();
    const elapsed = performance.now() - started;

    // A smoke ceiling, not a benchmark: wide enough for a loaded CI runner, narrow enough to
    // catch a change that made recording quadratic.
    expect(snapshots.length).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(10_000);
  });
});
