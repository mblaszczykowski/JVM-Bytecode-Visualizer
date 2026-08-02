/**
 * The run as a map rather than as a length: where control moved, where the machine wrote
 * something, and where a debugger's step over / step out would land.
 *
 * Everything here is derived from the snapshot history alone and reads no more than two
 * consecutive snapshots at a time, so it stays linear over a twenty-thousand step run.
 */

import type { ArrayObject, Snapshot } from '../core/interpreter';

/**
 * Smallest step after `from` at the same call stack depth or shallower — where a debugger's
 * "step over" lands. On a call that is the step after the callee returned; on anything else
 * it is simply the next step.
 *
 * `undefined` when the history ends inside the callee (a VM error or the step limit), which
 * is a disabled control rather than a jump to some other frame's step.
 */
export function stepOverTarget(depths: readonly number[], from: number): number | undefined {
  const depth = depths[from];
  return depth === undefined ? undefined : nextStepNoDeeperThan(depths, from, depth);
}

/**
 * Smallest step after `from` strictly shallower than it — where "step out" lands, i.e. the
 * step at which the frame on top has returned. `undefined` at depth 0 and when the frame
 * never returns within the history.
 */
export function stepOutTarget(depths: readonly number[], from: number): number | undefined {
  const depth = depths[from];
  if (depth === undefined || depth === 0) {
    return undefined;
  }
  return nextStepNoDeeperThan(depths, from, depth - 1);
}

function nextStepNoDeeperThan(
  depths: readonly number[],
  from: number,
  deepest: number,
): number | undefined {
  for (let step = from + 1; step < depths.length; step++) {
    if ((depths[step] ?? 0) <= deepest) {
      return step;
    }
  }
  return undefined;
}

/**
 * What a step did, as far as the scrubber is concerned. A step does at most one of these:
 * pushing or popping a frame rules out everything else, and no instruction in the subset both
 * jumps and writes.
 */
export type TimelineEventKind = 'call' | 'return' | 'print' | 'heap-write' | 'branch';

export interface TimelineEvent {
  /** Index of the snapshot whose instruction caused it. */
  readonly step: number;
  readonly kind: TimelineEventKind;
}

/** How each kind reads when the scrubber announces the step it is sitting on. */
export const TIMELINE_EVENT_LABELS: Readonly<Record<TimelineEventKind, string>> = {
  call: 'call',
  return: 'return',
  print: 'console output',
  'heap-write': 'heap write',
  branch: 'branch taken',
};

/**
 * Most specific first. Two events landing in the same column of a bucketed track leave room
 * for one mark, and the depth chart underneath already draws calls and returns as its shape,
 * so a write the chart cannot show outranks them.
 */
const MARK_ORDER: readonly TimelineEventKind[] = [
  'print',
  'heap-write',
  'call',
  'return',
  'branch',
];

/** Events of the whole run, ascending by step — `bucketEvents` relies on that order. */
export function timelineEventsOf(snapshots: readonly Snapshot[]): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (let step = 0; step + 1 < snapshots.length; step++) {
    const before = snapshots[step];
    const after = snapshots[step + 1];
    if (before === undefined || after === undefined) {
      continue;
    }
    const kind = eventBetween(before, after);
    if (kind !== undefined) {
      events.push({ step, kind });
    }
  }

  return events;
}

function eventBetween(before: Snapshot, after: Snapshot): TimelineEventKind | undefined {
  const depth = before.callStack.length;
  const next = after.callStack.length;
  if (next > depth) {
    return 'call';
  }
  if (next < depth) {
    return 'return';
  }
  if (consoleGrew(before.consoleOutput ?? [], after.consoleOutput ?? [])) {
    return 'print';
  }
  if (heapChanged(before.heap ?? [], after.heap ?? [])) {
    return 'heap-write';
  }
  return branchWasTaken(before, after) ? 'branch' : undefined;
}

/**
 * `print` and `println` both land in the last line of the view, so a new line is not the only
 * thing that counts as output — `print("a"); print("b")` writes twice into one line.
 */
function consoleGrew(before: readonly string[], after: readonly string[]): boolean {
  if (before === after) {
    return false;
  }
  return before.length === after.length
    ? before.at(-1) !== after.at(-1)
    : after.length > before.length;
}

/**
 * A step that touched no array hands back the very array and the very objects it handed back
 * last time (see `Heap.freeze`), so identity decides this without comparing elements.
 */
function heapChanged(before: readonly ArrayObject[], after: readonly ArrayObject[]): boolean {
  if (before === after) {
    return false;
  }
  if (before.length !== after.length) {
    return true;
  }
  return after.some((array, handle) => array !== before[handle]);
}

/**
 * Whether control left the instruction by its branch target rather than falling through.
 *
 * The successor pc is compared against the target, not against the fall-through, because the
 * byte length of an instruction is not in the history. The two only coincide for a branch
 * aimed at the instruction after it, which is a jump javac has no reason to emit.
 */
function branchWasTaken(before: Snapshot, after: Snapshot): boolean {
  const instruction = before.currentInstruction;
  const pc = after.callStack.at(-1)?.pc;
  if (instruction === undefined || pc === undefined) {
    return false;
  }
  if (instruction.branchTarget !== undefined) {
    return pc === instruction.branchTarget;
  }
  // Every arm of a switch is a jump, the default one included: there is no fall-through.
  return instruction.switchTargets?.some((arm) => arm.target === pc) ?? false;
}

export interface StepBucket {
  readonly firstStep: number;
  readonly lastStep: number;
}

/**
 * Partition of a history into at most `bucketCount` contiguous ranges — the resolution the
 * scrubber can actually draw. Depth bars and event marks are both cut here, so a mark always
 * sits above the bar covering the same steps.
 */
export function stepBucketsOf(stepCount: number, bucketCount: number): readonly StepBucket[] {
  const count = Math.min(Math.max(bucketCount, 1), Math.max(stepCount, 1));
  const buckets: StepBucket[] = [];

  for (let bucket = 0; bucket < count; bucket++) {
    const firstStep = Math.floor((bucket * stepCount) / count);
    const lastStep = Math.max(firstStep, Math.floor(((bucket + 1) * stepCount) / count) - 1);
    buckets.push({ firstStep, lastStep });
  }

  return buckets;
}

/**
 * One mark per bucket, or `undefined` where nothing happened. A bucket of a long run holds
 * hundreds of events; drawing them all would fill the lane, so each column keeps the single
 * most specific thing that happened in it.
 *
 * `events` must be ascending by step, which is what `timelineEventsOf` produces.
 */
export function bucketEvents(
  events: readonly TimelineEvent[],
  buckets: readonly StepBucket[],
): readonly (TimelineEventKind | undefined)[] {
  const marks = new Array<TimelineEventKind | undefined>(buckets.length).fill(undefined);
  let index = 0;

  for (const event of events) {
    while (index < buckets.length && event.step > (buckets[index]?.lastStep ?? -1)) {
      index++;
    }
    const bucket = buckets[index];
    if (bucket === undefined) {
      break;
    }
    if (event.step < bucket.firstStep) {
      continue;
    }
    const current = marks[index];
    if (current === undefined || MARK_ORDER.indexOf(event.kind) < MARK_ORDER.indexOf(current)) {
      marks[index] = event.kind;
    }
  }

  return marks;
}

/** The event at exactly `step`, by binary search over the ascending list. */
export function eventAt(
  events: readonly TimelineEvent[],
  step: number,
): TimelineEventKind | undefined {
  let low = 0;
  let high = events.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const event = events[middle];
    if (event === undefined) {
      return undefined;
    }
    if (event.step === step) {
      return event.kind;
    }
    if (event.step < step) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return undefined;
}
