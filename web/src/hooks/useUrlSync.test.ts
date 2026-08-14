import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { useUrlSync } from './useUrlSync';

interface SyncProps {
  readonly exampleId: string | undefined;
  readonly isPlaying: boolean;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly tour?: { readonly id: string; readonly stopIndex: number } | undefined;
}

const FACTORIAL: SyncProps = {
  exampleId: 'factorial',
  isPlaying: false,
  stepIndex: 0,
  stepCount: 40,
};

const LONGER_THAN_ANY_COALESCING = 2_000;

let replaceState: MockInstance<typeof window.history.replaceState>;

function settle(): void {
  act(() => {
    vi.advanceTimersByTime(LONGER_THAN_ANY_COALESCING);
  });
}

function renderSync(initialProps: SyncProps) {
  const view = renderHook(
    (props: SyncProps) => {
      useUrlSync({ tour: undefined, ...props });
    },
    { initialProps },
  );
  settle();

  return {
    rerender: (next: SyncProps) => {
      view.rerender(next);
      settle();
    },
    written: () => replaceState.mock.calls.map(([, , url]) => url),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/');
  replaceState = vi.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  replaceState.mockRestore();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('useUrlSync', () => {
  it('writes the step the reader is on', () => {
    const view = renderSync(FACTORIAL);

    expect(view.written()).toEqual(['#/factorial/1']);
    expect(window.location.hash).toBe('#/factorial/1');

    view.rerender({ ...FACTORIAL, stepIndex: 12 });

    expect(view.written()).toEqual(['#/factorial/1', '#/factorial/13']);
    expect(window.location.hash).toBe('#/factorial/13');
  });

  it('writes nothing at all while the run is playing', () => {
    const view = renderSync({ ...FACTORIAL, isPlaying: true });

    for (const stepIndex of [1, 2, 3, 4, 5, 6, 7, 8]) {
      view.rerender({ ...FACTORIAL, isPlaying: true, stepIndex });
    }

    expect(view.written()).toEqual([]);
    expect(window.location.hash).toBe('');
  });

  it('writes the step it stopped on once playback ends', () => {
    const view = renderSync({ ...FACTORIAL, isPlaying: true, stepIndex: 9 });

    view.rerender({ ...FACTORIAL, isPlaying: false, stepIndex: 9 });

    expect(view.written()).toEqual(['#/factorial/10']);
  });

  it('writes the tour stop rather than the step while a tour is running', () => {
    const view = renderSync({
      ...FACTORIAL,
      stepIndex: 9,
      tour: { id: 'recursion', stopIndex: 2 },
    });

    expect(view.written()).toEqual(['#/factorial/tour/recursion/3']);
  });

  it('writes the example alone when there is nothing to step through', () => {
    const view = renderSync({ ...FACTORIAL, stepCount: 0 });

    expect(view.written()).toEqual(['#/factorial']);
  });

  it('leaves the address bar alone for a program no link can reach', () => {
    const view = renderSync({ ...FACTORIAL, exampleId: undefined });

    view.rerender({ ...FACTORIAL, exampleId: undefined, stepIndex: 4 });

    expect(view.written()).toEqual([]);
    expect(window.location.hash).toBe('');
  });
});
