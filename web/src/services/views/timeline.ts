import type { HeapObject, Snapshot } from '../../core/interpreter';

export function stepOverTarget(depths: readonly number[], from: number): number | undefined {
  const depth = depths[from];
  return depth === undefined ? undefined : nextStepNoDeeperThan(depths, from, depth);
}

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

export type TimelineEventKind = 'call' | 'return' | 'print' | 'heap-write' | 'branch';

export interface TimelineEvent {
  readonly step: number;
  readonly kind: TimelineEventKind;
}

export const TIMELINE_EVENT_LABELS: Readonly<Record<TimelineEventKind, string>> = {
  call: 'call',
  return: 'return',
  print: 'console output',
  'heap-write': 'heap write',
  branch: 'branch taken',
};

const MARK_ORDER: readonly TimelineEventKind[] = [
  'print',
  'heap-write',
  'call',
  'return',
  'branch',
];

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

function consoleGrew(before: readonly string[], after: readonly string[]): boolean {
  if (before === after) {
    return false;
  }
  return before.length === after.length
    ? before.at(-1) !== after.at(-1)
    : after.length > before.length;
}

function heapChanged(before: readonly HeapObject[], after: readonly HeapObject[]): boolean {
  if (before === after) {
    return false;
  }
  if (before.length !== after.length) {
    return true;
  }
  return after.some((array, handle) => array !== before[handle]);
}

function branchWasTaken(before: Snapshot, after: Snapshot): boolean {
  const instruction = before.currentInstruction;
  const pc = after.callStack.at(-1)?.pc;
  if (instruction === undefined || pc === undefined) {
    return false;
  }
  if (instruction.branchTarget !== undefined) {
    return pc === instruction.branchTarget;
  }
  return instruction.switchTargets?.some((arm) => arm.target === pc) ?? false;
}

export interface StepBucket {
  readonly firstStep: number;
  readonly lastStep: number;
}

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
