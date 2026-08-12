import { describe, expect, it } from 'vitest';

import { execute } from './interpreter';
import type { Snapshot } from './types';

import { expectCompleted } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
} from './__fixtures__/synthetic-class';

const DEPTH = 200;

const ITERATIONS = 4_000;

function deepRecursion(): readonly Snapshot[] {
  const pool = new ConstantPoolBuilder();
  const down = pool.methodref(SYNTHETIC_CLASS_NAME, 'down', '(I)I');
  const classFile = syntheticClass({
    pool,
    methods: [
      {
        name: 'main',
        descriptor: '()I',
        code: [0x11, (DEPTH >> 8) & 0xff, DEPTH & 0xff, 0xb8, 0x00, down, 0xac],
      },
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

function countingLoop(): readonly Snapshot[] {
  const classFile = syntheticClass({
    methods: [
      {
        name: 'main',
        descriptor: '()V',
        code: [
          0x03,
          0x3b,
          0x1a,
          0x11,
          (ITERATIONS >> 8) & 0xff,
          ITERATIONS & 0xff,
          0xa2,
          0x00,
          0x09,
          0x84,
          0x00,
          0x01,
          0xa7,
          0xff,
          0xf6,
          0xb1,
        ],
        maxLocals: 2,
      },
    ],
  });

  return expectCompleted(execute(classFile, { maxSteps: 40_000 })).snapshots;
}

function naiveFrameCopies(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((total, snapshot) => total + snapshot.callStack.length, 0);
}

function actualFrameCopies(snapshots: readonly Snapshot[]): number {
  const seen = new Set<unknown>();
  for (const snapshot of snapshots) {
    for (const frame of snapshot.callStack) {
      seen.add(frame);
    }
  }
  return seen.size;
}

describe('snapshot history allocation (ADR-0001)', () => {
  it('allocates 89 times fewer frames than per-step copying would', () => {
    const snapshots = deepRecursion();
    const naive = naiveFrameCopies(snapshots);
    const actual = actualFrameCopies(snapshots);

    expect(snapshots.length).toBe(1_408);
    expect(naive).toBe(142_911);
    expect(actual).toBe(1_608);
    expect(naive / actual).toBeGreaterThan(85);
    expect(naive / actual).toBeLessThan(92);
  });

  it('shares one frame object between consecutive steps that did not touch it', () => {
    const snapshots = deepRecursion();
    const deepest = snapshots.reduce((best, snapshot) =>
      snapshot.callStack.length > best.callStack.length ? snapshot : best,
    );
    const at = snapshots.indexOf(deepest);
    const next = snapshots[at + 1];

    expect(deepest.callStack.length).toBeGreaterThan(DEPTH);
    expect(next?.callStack[0]).toBe(deepest.callStack[0]);
    expect(next?.callStack[1]).toBe(deepest.callStack[1]);
  });

  it('keeps the per-step cost of a flat run to one frame', () => {
    const snapshots = countingLoop();

    expect(snapshots.length).toBe(20_007);
    expect(snapshots.length).toBeGreaterThan(ITERATIONS * 4);
    expect(snapshots.at(-1)?.callStack).toEqual([]);
    expect(actualFrameCopies(snapshots)).toBe(snapshots.length - 1);
  });
});
