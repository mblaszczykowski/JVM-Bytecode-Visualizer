import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../core/classfile';
import { execute } from '../core/interpreter';
import type { Snapshot } from '../core/interpreter';

import { readExampleBytes } from './__fixtures__/example-files';
import { depthsOf } from './program';
import {
  bucketEvents,
  eventAt,
  stepBucketsOf,
  stepOutTarget,
  stepOverTarget,
  timelineEventsOf,
  type TimelineEvent,
  type TimelineEventKind,
} from './timeline';

/** A shipped example run exactly as the application runs it. */
function runOf(name: string): readonly Snapshot[] {
  return execute(parseClassFile(readExampleBytes(`${name}.class`))).snapshots;
}

function stepsOf(events: readonly TimelineEvent[], kind: TimelineEventKind): readonly number[] {
  return events.filter((event) => event.kind === kind).map((event) => event.step);
}

function mnemonicsAt(
  snapshots: readonly Snapshot[],
  steps: readonly number[],
): readonly (string | undefined)[] {
  return [...new Set(steps.map((step) => snapshots[step]?.currentInstruction?.mnemonic))].sort();
}

describe('stepping targets', () => {
  // main calls factorial, which recurses four deep: depth 1 at the ends, 5 in the middle.
  const factorial = depthsOf(runOf('Factorial'));

  it('runs a call to completion and stops after it returns', () => {
    // Step 1 is the invokestatic in main; the whole recursion is steps 2–36.
    expect(factorial[1]).toBe(1);
    expect(stepOverTarget(factorial, 1)).toBe(37);
    expect(factorial[37]).toBe(1);
  });

  it('behaves like a plain step forward on an instruction that is not a call', () => {
    const insideCallee = 4;
    expect(stepOverTarget(factorial, insideCallee)).toBe(insideCallee + 1);
  });

  it('leaves the frame on top rather than the one below it', () => {
    // Step 28 is the deepest frame, factorial(1), alive for steps 26–30.
    expect(factorial[28]).toBe(5);
    expect(stepOutTarget(factorial, 28)).toBe(31);
    expect(factorial[31]).toBe(4);
  });

  it('has nothing to step out of at depth 0', () => {
    expect(stepOutTarget([0, 1, 0], 0)).toBeUndefined();
  });

  it('reports no target on the last step of the history', () => {
    const last = factorial.length - 1;
    expect(stepOverTarget(factorial, last)).toBeUndefined();
    expect(stepOutTarget(factorial, last)).toBeUndefined();
  });

  it('reports no target when the run ends inside the callee', () => {
    // A history cut short by the step limit never comes back down to the caller's depth.
    const cutShort = [1, 2, 3, 4];
    expect(stepOverTarget(cutShort, 1)).toBeUndefined();
    expect(stepOutTarget(cutShort, 1)).toBeUndefined();
  });

  it('says nothing about a step outside the history', () => {
    expect(stepOverTarget([1, 1], 7)).toBeUndefined();
    expect(stepOutTarget([1, 1], -1)).toBeUndefined();
  });

  it('lands on the first step at or below the starting depth, never on a later one', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 60 }),
        fc.nat(),
        (depths, offset) => {
          const from = offset % depths.length;
          const depth = depths[from] ?? 0;
          const target = stepOverTarget(depths, from);
          const skipped = depths.slice(from + 1, target ?? depths.length);

          expect(skipped.every((value) => value > depth)).toBe(true);
          if (target !== undefined) {
            expect(target).toBeGreaterThan(from);
            expect(depths[target]).toBeLessThanOrEqual(depth);
          }
        },
      ),
    );
  });

  it('steps out no earlier than it steps over', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 60 }),
        fc.nat(),
        (depths, offset) => {
          const from = offset % depths.length;
          const out = stepOutTarget(depths, from);
          if (out === undefined) {
            return;
          }
          const over = stepOverTarget(depths, from);
          expect(over).toBeDefined();
          expect(out).toBeGreaterThanOrEqual(over ?? 0);
          expect(depths[out]).toBeLessThan(depths[from] ?? 0);
        },
      ),
    );
  });
});

describe('timelineEventsOf', () => {
  it('marks a pushed frame as a call and a popped one as a return', () => {
    const snapshots = runOf('Factorial');
    const events = timelineEventsOf(snapshots);
    const depths = depthsOf(snapshots);

    expect(mnemonicsAt(snapshots, stepsOf(events, 'call'))).toEqual(['invokestatic']);
    expect(mnemonicsAt(snapshots, stepsOf(events, 'return'))).toEqual(['ireturn', 'return']);
    for (const step of stepsOf(events, 'call')) {
      expect(depths[step + 1]).toBe((depths[step] ?? 0) + 1);
    }
  });

  it('marks every line the program printed, and nothing else', () => {
    const snapshots = runOf('Collatz');
    const printed = snapshots.at(-1)?.consoleOutput ?? [];

    expect(printed.length).toBeGreaterThan(1);
    expect(stepsOf(timelineEventsOf(snapshots), 'print')).toHaveLength(printed.length);
  });

  it('marks allocations and element writes on the heap', () => {
    const snapshots = runOf('BubbleSort');
    const writes = stepsOf(timelineEventsOf(snapshots), 'heap-write');

    expect(mnemonicsAt(snapshots, writes)).toEqual(['iastore', 'newarray']);
    expect(writes).toHaveLength(
      snapshots.filter((snapshot) => {
        const mnemonic = snapshot.currentInstruction?.mnemonic;
        return mnemonic === 'iastore' || mnemonic === 'newarray';
      }).length,
    );
  });

  it('marks a branch only where control really left for the target', () => {
    const snapshots = runOf('SumOfProducts');
    const taken = stepsOf(timelineEventsOf(snapshots), 'branch');

    for (const step of taken) {
      const instruction = snapshots[step]?.currentInstruction;
      expect(instruction?.branchTarget).toBe(snapshots[step + 1]?.callStack.at(-1)?.pc);
    }

    const branches = snapshots.filter(
      (snapshot) => snapshot.currentInstruction?.branchTarget !== undefined,
    );
    // The run executes far more branch instructions than it takes: the loops fall through
    // on every iteration but the last.
    expect(taken.length).toBeLessThan(branches.length);
  });

  it('leaves the terminal snapshot without an event and keeps the list ascending', () => {
    const snapshots = runOf('Gcd');
    const steps = timelineEventsOf(snapshots).map((event) => event.step);

    expect(steps.at(-1)).toBeLessThan(snapshots.length - 1);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('has nothing to report about a history of one snapshot', () => {
    expect(timelineEventsOf(runOf('Gcd').slice(0, 1))).toEqual([]);
    expect(timelineEventsOf([])).toEqual([]);
  });
});

describe('stepBucketsOf', () => {
  it('gives a short history one bucket per step', () => {
    expect(stepBucketsOf(3, 120)).toEqual([
      { firstStep: 0, lastStep: 0 },
      { firstStep: 1, lastStep: 1 },
      { firstStep: 2, lastStep: 2 },
    ]);
  });

  it('covers every step of a long history exactly once', () => {
    const buckets = stepBucketsOf(20_000, 120);

    expect(buckets).toHaveLength(120);
    expect(buckets[0]?.firstStep).toBe(0);
    expect(buckets.at(-1)?.lastStep).toBe(19_999);
    for (const [index, bucket] of buckets.entries()) {
      expect(bucket.lastStep).toBeGreaterThanOrEqual(bucket.firstStep);
      if (index > 0) {
        expect(bucket.firstStep).toBe((buckets[index - 1]?.lastStep ?? 0) + 1);
      }
    }
  });

  it('still produces a bucket for an empty history', () => {
    expect(stepBucketsOf(0, 120)).toEqual([{ firstStep: 0, lastStep: 0 }]);
  });
});

describe('bucketEvents', () => {
  const buckets = stepBucketsOf(10, 5);

  it('places each event in the bucket that holds its step', () => {
    expect(
      bucketEvents(
        [
          { step: 0, kind: 'call' },
          { step: 5, kind: 'return' },
          { step: 9, kind: 'branch' },
        ],
        buckets,
      ),
    ).toEqual(['call', undefined, 'return', undefined, 'branch']);
  });

  it('keeps the most specific event where several share a bucket', () => {
    // The depth chart already draws the call; the heap write is the thing it cannot show.
    expect(
      bucketEvents(
        [
          { step: 0, kind: 'call' },
          { step: 1, kind: 'heap-write' },
          { step: 4, kind: 'print' },
          { step: 5, kind: 'branch' },
        ],
        buckets,
      ),
    ).toEqual(['heap-write', undefined, 'print', undefined, undefined]);
  });

  it('ignores events past the end of the buckets', () => {
    expect(bucketEvents([{ step: 40, kind: 'call' }], buckets)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('marks at most one bucket per column of a real run', () => {
    const snapshots = runOf('BubbleSort');
    const marks = bucketEvents(timelineEventsOf(snapshots), stepBucketsOf(snapshots.length, 120));

    expect(marks).toHaveLength(120);
    expect(marks.some((mark) => mark === 'heap-write')).toBe(true);
  });
});

describe('eventAt', () => {
  const events: readonly TimelineEvent[] = [
    { step: 2, kind: 'call' },
    { step: 7, kind: 'print' },
    { step: 11, kind: 'return' },
  ];

  it('finds the event on a step that has one', () => {
    expect(eventAt(events, 2)).toBe('call');
    expect(eventAt(events, 7)).toBe('print');
    expect(eventAt(events, 11)).toBe('return');
  });

  it('reports nothing for a step between events or outside them', () => {
    expect(eventAt(events, 0)).toBeUndefined();
    expect(eventAt(events, 8)).toBeUndefined();
    expect(eventAt(events, 99)).toBeUndefined();
    expect(eventAt([], 3)).toBeUndefined();
  });
});
