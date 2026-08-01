/**
 * The wire between the application and the run worker.
 *
 * A run crosses this boundary in two directions and the two cost wildly different amounts.
 * Going out is a parsed `ClassFile` — a couple of kilobytes, cloned in tens of microseconds.
 * Coming back is the history, and a history at the `MAX_STEP_LIMIT` ceiling is 500,000 frozen
 * snapshots over roughly three million small arrays.
 *
 * Two things about that history decide the shape of this protocol, and both were measured
 * rather than assumed (Node 20 / V8, Apple silicon, `LongRun.class`, 500,000 steps):
 *
 * 1. Structured cloning *does* preserve the structural sharing `SnapshotWriter` and `Heap`
 *    build — the 36 distinct `Instruction` objects stay 36 on the far side, and so do the
 *    23,635 distinct heap views. What it does not preserve is `Object.freeze`, and a
 *    deserialised object graph costs about 2.2× the heap of the one that was built in place:
 *    274 MB becomes ~610 MB. Sharing survives the crossing; cheapness does not.
 * 2. Posting the whole history as one message costs ~1.4 s to serialise and ~2.0 s to
 *    deserialise — and the deserialising half runs on the main thread, the very thread the
 *    worker exists to free. Handing it over in batches costs *less* in total (~1.9 s against
 *    ~3.9 s: V8's back-reference table for a 500,000-node graph is worse than linear) and,
 *    far more importantly, splits the receiving cost into tasks the browser can interleave.
 *    At 2,000 snapshots a batch the longest main-thread task during the handover is ~13 ms,
 *    against 1,987 ms for one message and 450 ms for running the whole thing here instead.
 *
 * So the history is streamed. Nothing else about it changes: what arrives is the same array
 * of snapshots `execute()` returned, and the application cannot tell which thread built it.
 */

import type { ClassFile } from '../core/classfile';
import type { ExecutionResult, Snapshot } from '../core/interpreter';

/**
 * Snapshots per message. Small enough that receiving one batch fits inside a frame, large
 * enough that the per-message overhead stays invisible — 2,000 and 10,000 finish within 2%
 * of each other, and only the longest stall (13 ms against 37 ms) tells them apart.
 */
export const SNAPSHOTS_PER_MESSAGE = 2_000;

/** What the worker is asked to do. It executes what it is told and chooses nothing. */
export interface RunCommand {
  readonly classFile: ClassFile;
  readonly entryMethod: string;
  readonly maxSteps: number;
}

/** An `ExecutionResult` without its history — how the run ended, in a few dozen bytes. */
type WithoutHistory<T> = T extends unknown ? Omit<T, 'snapshots'> : never;
export type RunSummary = WithoutHistory<ExecutionResult>;

export type RunEvent =
  | { readonly kind: 'snapshots'; readonly snapshots: readonly Snapshot[] }
  /** Sent last, once every batch above is on its way: the history is already accounted for. */
  | { readonly kind: 'done'; readonly result: RunSummary }
  /** The interpreter threw rather than returning a `vm-error` — a bug, not a program fault. */
  | { readonly kind: 'failed'; readonly reason: string };

/** One identity for every run that produced nothing — a fresh `[]` rewinds the player. */
export const NO_SNAPSHOTS: readonly Snapshot[] = Object.freeze([]);

/**
 * Puts a history back next to the summary it belongs to. Used on both sides: the worker takes
 * the history *out* with it, the application puts the streamed one back in.
 */
export function withHistory(result: RunSummary, snapshots: readonly Snapshot[]): ExecutionResult {
  switch (result.kind) {
    case 'completed':
      return { ...result, snapshots };
    case 'vm-error':
      return { ...result, snapshots };
    case 'step-limit':
      return { ...result, snapshots };
  }
}
