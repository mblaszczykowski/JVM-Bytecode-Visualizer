import type { Snapshot } from '../core/interpreter/types';

export interface TourStop {
  readonly method: string;
  readonly pc: number;
  readonly visit?: number;
  readonly title: string;
  readonly body: string;
}

export interface Tour {
  readonly id: string;
  readonly exampleId: string;
  readonly title: string;
  readonly stops: readonly TourStop[];
}

export interface ResolvedStop {
  readonly step: number;
  readonly title: string;
  readonly body: string;
}

const TOURS: readonly Tour[] = [
  {
    id: 'recursion',
    exampleId: 'factorial',
    title: 'How recursion looks from underneath',
    stops: [
      {
        method: 'main',
        pc: 1,
        title: 'One call, and the stack starts growing',
        body: 'invokestatic pushes a new frame. The argument 4 is already on the operand stack; it becomes slot 0 of the frame that is about to exist.',
      },
      {
        method: 'factorial',
        pc: 2,
        title: 'The base case is a branch, not a keyword',
        body: 'if_icmpgt compares n against 1 and jumps past the early return when n is larger. There is nothing in the bytecode that knows this is recursion.',
      },
      {
        method: 'factorial',
        pc: 11,
        title: 'It calls itself, and nothing about that is special',
        body: 'The same invokestatic as in main, pointing at the same constant pool entry. Watch the call stack: each frame keeps its own n in slot 0, which is the whole reason recursion works.',
      },
      {
        method: 'factorial',
        pc: 6,
        visit: 1,
        title: 'The bottom',
        body: 'n reached 1, so this frame returns without calling anything. From here the stack only shrinks.',
      },
      {
        method: 'factorial',
        pc: 14,
        title: 'The multiplications happen on the way back',
        body: 'imul runs after the callee returned; its result is on the stack next to this frame’s n. Every frame was waiting here the whole time.',
      },
      {
        method: 'main',
        pc: 4,
        title: 'Five frames later, one number',
        body: 'istore_1 puts 24 into a local slot. The call stack is back to where it started.',
      },
    ],
  },
  {
    id: 'the-swap',
    exampleId: 'bubble-sort',
    title: 'What a swap costs in bytecode',
    stops: [
      {
        method: 'sortedMinimum',
        pc: 60,
        title: 'The temporary is a local slot',
        body: 'istore_3 keeps a[j] somewhere while its cell is overwritten. `int swap = a[j]` compiles to exactly this and nothing more.',
      },
      {
        method: 'sortedMinimum',
        pc: 68,
        title: 'The first write',
        body: 'iastore takes an array reference, an index and a value off the stack, in that order, bottom to top, and writes to the heap. Watch the heap panel: this is the moment the array changes.',
      },
      {
        method: 'sortedMinimum',
        pc: 74,
        title: 'The second write completes the swap',
        body: 'The saved value goes into the neighbouring cell. Two heap writes and one local slot: that is all a swap is, and the sort does it hundreds of times.',
      },
    ],
  },
];

export function toursFor(exampleId: string): readonly Tour[] {
  return TOURS.filter((tour) => tour.exampleId === exampleId);
}

export function tourFor(exampleId: string, tourId: string): Tour | undefined {
  return TOURS.find((tour) => tour.exampleId === exampleId && tour.id === tourId);
}

export function allTours(): readonly Tour[] {
  return TOURS;
}

export function resolveTour(tour: Tour, snapshots: readonly Snapshot[]): readonly ResolvedStop[] {
  const resolved: ResolvedStop[] = [];
  for (const stop of tour.stops) {
    const step = stepOf(stop, snapshots);
    if (step !== undefined) {
      resolved.push({ step, title: stop.title, body: stop.body });
    }
  }
  return resolved;
}

function stepOf(stop: TourStop, snapshots: readonly Snapshot[]): number | undefined {
  const wanted = stop.visit ?? 1;
  let seen = 0;
  for (const [step, snapshot] of snapshots.entries()) {
    if (
      snapshot.currentInstruction?.offset === stop.pc &&
      snapshot.callStack.at(-1)?.methodName === stop.method
    ) {
      seen += 1;
      if (seen === wanted) {
        return step;
      }
    }
  }
  return undefined;
}
