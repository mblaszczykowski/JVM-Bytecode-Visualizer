import { describe, expect, it } from 'vitest';

import { snapshots as bubbleSortSnapshots } from '../components/__fixtures__/bubble-sort-run';
import { snapshots as factorialSnapshots } from '../components/__fixtures__/factorial-run';
import type { Snapshot } from '../core/interpreter/types';

import { allTours, resolveTour, tourFor, toursFor, type Tour } from './tours';

const RUNS: Readonly<Record<string, () => readonly Snapshot[]>> = {
  factorial: factorialSnapshots,
  'bubble-sort': bubbleSortSnapshots,
};

function runFor(tour: Tour): readonly Snapshot[] {
  const run = RUNS[tour.exampleId];
  if (run === undefined) {
    throw new Error(`no bundled run for ${tour.exampleId}; add it to RUNS`);
  }
  return run();
}

describe('the bundled tours', () => {
  it.each(allTours().map((tour) => [`${tour.exampleId}/${tour.id}`, tour] as const))(
    '%s resolves every one of its stops against the real run',
    (_name, tour) => {
      const resolved = resolveTour(tour, runFor(tour));

      expect(resolved).toHaveLength(tour.stops.length);
    },
  );

  it.each(allTours().map((tour) => [`${tour.exampleId}/${tour.id}`, tour] as const))(
    '%s only moves forward through the run',
    (_name, tour) => {
      const steps = resolveTour(tour, runFor(tour)).map((stop) => stop.step);

      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(new Set(steps).size).toBe(steps.length);
    },
  );

  it.each(allTours().map((tour) => [`${tour.exampleId}/${tour.id}`, tour] as const))(
    '%s lands on the instruction each stop names',
    (_name, tour) => {
      const run = runFor(tour);

      for (const [index, stop] of tour.stops.entries()) {
        const step = resolveTour(tour, run)[index]?.step ?? -1;
        const snapshot = run[step];
        expect(snapshot?.currentInstruction?.offset).toBe(stop.pc);
        expect(snapshot?.callStack.at(-1)?.methodName).toBe(stop.method);
      }
    },
  );

  it('gives every tour a kebab-case id, because it goes in a URL', () => {
    for (const tour of allTours()) {
      expect(tour.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('writes something at every stop', () => {
    for (const stop of allTours().flatMap((tour) => tour.stops)) {
      expect(stop.title.length).toBeGreaterThan(0);
      expect(stop.body.length).toBeGreaterThan(40);
    }
  });
});

describe('lookup', () => {
  it('finds a tour by the example and the id in the link', () => {
    expect(tourFor('factorial', 'recursion')?.title).toMatch(/recursion/i);
  });

  it('does not find a tour belonging to another example', () => {
    expect(tourFor('bubble-sort', 'recursion')).toBeUndefined();
  });

  it('lists what an example has to offer, and nothing for one with no tours', () => {
    expect(toursFor('factorial').map((tour) => tour.id)).toEqual(['recursion']);
    expect(toursFor('collatz')).toEqual([]);
  });
});

describe('resolveTour', () => {
  it('drops a stop that no longer resolves rather than guessing', () => {
    const drifted: Tour = {
      id: 'drifted',
      exampleId: 'factorial',
      title: 'Points at an offset that is not there',
      stops: [
        { method: 'factorial', pc: 2, title: 'Real', body: 'x'.repeat(41) },
        { method: 'factorial', pc: 9999, title: 'Gone', body: 'x'.repeat(41) },
      ],
    };

    expect(resolveTour(drifted, factorialSnapshots())).toHaveLength(1);
  });

  it('counts arrivals, so a stop can name a later pass through a loop', () => {
    const run = bubbleSortSnapshots();
    const stop = { method: 'sortedMinimum', pc: 68, title: 'a', body: 'x'.repeat(41) };
    const first: Tour = {
      id: 'first',
      exampleId: 'bubble-sort',
      title: 'First arrival',
      stops: [stop],
    };
    const third: Tour = { ...first, stops: [{ ...stop, visit: 3 }] };

    const firstStep = resolveTour(first, run)[0]?.step ?? -1;
    const thirdStep = resolveTour(third, run)[0]?.step ?? -1;

    expect(thirdStep).toBeGreaterThan(firstStep);
    expect(run[thirdStep]?.currentInstruction?.offset).toBe(68);
  });
});
