import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snapshots as factorialSnapshots } from '../components/__fixtures__/factorial-run';
import type { Snapshot } from '../core/interpreter';
import type { DeepLink } from '../services/session/deep-link';
import { tourFor, type TourStop } from '../services/views/tours';

import { useGuidedTour } from './useGuidedTour';

const TOUR_ID = 'recursion';

const NO_SNAPSHOTS: readonly Snapshot[] = [];

interface Position {
  readonly method: string | undefined;
  readonly pc: number | undefined;
}

function tourStops(): readonly TourStop[] {
  const tour = tourFor('factorial', TOUR_ID);
  if (tour === undefined) {
    throw new Error(`the factorial ${TOUR_ID} tour is no longer in the catalogue`);
  }
  return tour.stops;
}

function stopPosition(index: number): Position {
  const stop = tourStops()[index];
  if (stop === undefined) {
    throw new Error(`the ${TOUR_ID} tour has no stop ${String(index)}`);
  }
  return { method: stop.method, pc: stop.pc };
}

function positionAt(step: number | undefined): Position {
  const snapshot = step === undefined ? undefined : factorialSnapshots()[step];
  return {
    method: snapshot?.callStack.at(-1)?.methodName,
    pc: snapshot?.currentInstruction?.offset,
  };
}

interface TourProps {
  readonly exampleId: string | undefined;
  readonly snapshots: readonly Snapshot[];
  readonly openedAt: DeepLink | undefined;
}

const FACTORIAL: TourProps = {
  exampleId: 'factorial',
  snapshots: factorialSnapshots(),
  openedAt: undefined,
};

const NOTHING_LOADED: TourProps = {
  exampleId: undefined,
  snapshots: NO_SNAPSHOTS,
  openedAt: undefined,
};

function renderTour(props: TourProps) {
  const seekTo = vi.fn<(step: number) => void>();
  const view = renderHook((current: TourProps) => useGuidedTour({ ...current, seekTo }), {
    initialProps: props,
  });
  return {
    ...view,
    seekTo,
    landedOn: () => positionAt(seekTo.mock.lastCall?.[0]),
  };
}

describe('useGuidedTour', () => {
  it('offers the tours belonging to the loaded example, and none before one is loaded', () => {
    const { result, rerender } = renderTour(NOTHING_LOADED);

    expect(result.current.available).toEqual([]);

    rerender(FACTORIAL);

    expect(result.current.available.map((tour) => tour.id)).toEqual([TOUR_ID]);
    expect(result.current.active).toBeUndefined();
  });

  it('seeks to the first stop when a tour starts', () => {
    const { result, seekTo, landedOn } = renderTour(FACTORIAL);

    expect(seekTo).not.toHaveBeenCalled();

    act(() => {
      result.current.start(TOUR_ID);
    });

    expect(result.current.active?.tour.id).toBe(TOUR_ID);
    expect(result.current.stopIndex).toBe(0);
    expect(landedOn()).toEqual(stopPosition(0));
  });

  it('seeks to each stop it is sent to', () => {
    const { result, landedOn } = renderTour(FACTORIAL);

    act(() => {
      result.current.start(TOUR_ID);
    });
    act(() => {
      result.current.goToStop(2);
    });

    expect(result.current.stopIndex).toBe(2);
    expect(landedOn()).toEqual(stopPosition(2));

    act(() => {
      result.current.goToStop(1);
    });

    expect(result.current.stopIndex).toBe(1);
    expect(landedOn()).toEqual(stopPosition(1));
  });

  it('ignores a stop the run does not reach', () => {
    const { result, seekTo } = renderTour(FACTORIAL);

    act(() => {
      result.current.start(TOUR_ID);
    });
    seekTo.mockClear();

    act(() => {
      result.current.goToStop(tourStops().length);
    });

    expect(result.current.stopIndex).toBe(0);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it('stops seeking once the tour is left', () => {
    const { result, rerender, seekTo } = renderTour(FACTORIAL);

    act(() => {
      result.current.start(TOUR_ID);
    });
    act(() => {
      result.current.goToStop(1);
    });
    seekTo.mockClear();

    act(() => {
      result.current.leave();
    });

    expect(result.current.active).toBeUndefined();
    expect(result.current.stopIndex).toBe(0);
    expect(seekTo).not.toHaveBeenCalled();

    rerender(FACTORIAL);

    expect(seekTo).not.toHaveBeenCalled();
  });

  it('restores the tour the link names once the run has loaded', () => {
    const openedAt: DeepLink = { exampleId: 'factorial', tour: { tourId: TOUR_ID, stopIndex: 3 } };
    const { result, rerender, seekTo, landedOn } = renderTour({ ...NOTHING_LOADED, openedAt });

    expect(result.current.active).toBeUndefined();
    expect(seekTo).not.toHaveBeenCalled();

    rerender({ ...FACTORIAL, openedAt });

    expect(result.current.active?.tour.id).toBe(TOUR_ID);
    expect(result.current.stopIndex).toBe(3);
    expect(landedOn()).toEqual(stopPosition(3));
  });

  it('puts the transport back on the stop when the same program is run again', () => {
    const { result, rerender, seekTo, landedOn } = renderTour(FACTORIAL);

    act(() => {
      result.current.start(TOUR_ID);
    });
    act(() => {
      result.current.goToStop(3);
    });
    seekTo.mockClear();

    rerender({ ...FACTORIAL, snapshots: [...factorialSnapshots()] });

    expect(result.current.stopIndex).toBe(3);
    expect(landedOn()).toEqual(stopPosition(3));
  });

  it('does not restore a tour stop outside the recorded run', () => {
    const openedAt: DeepLink = { exampleId: 'factorial', tour: { tourId: TOUR_ID, stopIndex: 99 } };
    const { result, seekTo } = renderTour({ ...FACTORIAL, openedAt });

    expect(result.current.active).toBeUndefined();
    expect(result.current.stopIndex).toBe(0);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it('leaves the tour when a different example replaces the program', () => {
    const { result, rerender, seekTo } = renderTour(FACTORIAL);
    act(() => {
      result.current.start(TOUR_ID);
      result.current.goToStop(2);
    });

    rerender({ ...FACTORIAL, exampleId: 'gcd' });
    seekTo.mockClear();
    rerender(FACTORIAL);

    expect(result.current.active).toBeUndefined();
    expect(seekTo).not.toHaveBeenCalled();
  });

  it('keeps the tour through a loading state when the same example is rerun', () => {
    const { result, rerender, seekTo } = renderTour(FACTORIAL);
    act(() => {
      result.current.start(TOUR_ID);
    });
    act(() => {
      result.current.goToStop(2);
    });

    rerender(NOTHING_LOADED);
    seekTo.mockClear();
    rerender(FACTORIAL);

    expect(result.current.active?.tour.id).toBe(TOUR_ID);
    expect(result.current.stopIndex).toBe(2);
    expect(seekTo).toHaveBeenCalled();
  });

  it('leaves the link alone until the example it names is the one that loaded', () => {
    const openedAt: DeepLink = { exampleId: 'factorial', tour: { tourId: TOUR_ID, stopIndex: 1 } };
    const { result, rerender, seekTo, landedOn } = renderTour({
      exampleId: 'bubble-sort',
      snapshots: factorialSnapshots(),
      openedAt,
    });

    expect(result.current.active).toBeUndefined();
    expect(seekTo).not.toHaveBeenCalled();

    rerender({ ...FACTORIAL, openedAt });

    expect(result.current.stopIndex).toBe(1);
    expect(landedOn()).toEqual(stopPosition(1));
  });
});
