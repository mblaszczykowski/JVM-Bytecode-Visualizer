import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readExampleBytes } from '../services/__fixtures__/example-files';
import {
  exampleRoutes,
  okResponse,
  statusResponse,
  stubFetch,
} from '../services/__fixtures__/fake-fetch';
import { exampleUrl } from '../services/loading/examples';
import type { ExampleEntry } from '../services/loading/manifest';
import { inlineRunner, type ProgramRunner } from '../services/loading/program-runner';

import { useExamplePreviews } from './useExamplePreviews';

const FACTORIAL: ExampleEntry = {
  id: 'factorial',
  title: 'Factorial: recursion',
  tagline: 'Five frames deep and back: 4! = 24.',
  description: 'Recursive 4! = 24.',
  classFile: 'Factorial.class',
  sourceFile: 'Factorial.java',
  entryMethod: 'main',
  resultVariable: 'result',
  expectedResult: 24,
};

const GCD: ExampleEntry = {
  id: 'gcd',
  title: 'GCD: while loop and remainder',
  tagline: "Euclid's loop on (1071, 462) = 21.",
  description: "Euclid's algorithm for (1071, 462) = 21.",
  classFile: 'Gcd.class',
  sourceFile: 'Gcd.java',
  entryMethod: 'main',
  resultVariable: 'result',
  expectedResult: 21,
};

const NO_ENTRIES: readonly ExampleEntry[] = [];

interface HeldRuns {
  readonly runner: ProgramRunner;
  readonly signals: readonly (AbortSignal | undefined)[];
  readonly release: () => void;
}

function heldRuns(): HeldRuns {
  const waiting: (() => void)[] = [];
  const signals: (AbortSignal | undefined)[] = [];

  return {
    runner: {
      cancellable: true,
      async run(command, options) {
        signals.push(options?.signal);
        await new Promise<void>((resolve) => waiting.push(resolve));
        return inlineRunner.run(command, options);
      },
    },
    signals,
    release: () => {
      waiting.shift()?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useExamplePreviews', () => {
  it('has nothing to show before the manifest arrives', () => {
    stubFetch(exampleRoutes());
    const { result } = renderHook(() => useExamplePreviews(NO_ENTRIES, inlineRunner));

    expect(result.current.size).toBe(0);
  });

  it('runs each example once and keeps its shape, keyed by id', async () => {
    stubFetch(exampleRoutes());
    const entries = [FACTORIAL];
    const { result } = renderHook(() => useExamplePreviews(entries, inlineRunner));

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    const preview = result.current.get('factorial');
    expect(preview?.steps).toBe(40);
    expect(preview?.maxDepth).toBe(5);
    expect(preview?.profile.length).toBeGreaterThan(0);
  });

  it('carries on down the list when one example cannot be downloaded', async () => {
    const entries = [FACTORIAL, GCD];
    stubFetch({
      ...exampleRoutes(),
      [exampleUrl('Factorial.class')]: () => statusResponse(404),
    });

    const { result } = renderHook(() => useExamplePreviews(entries, inlineRunner));

    await waitFor(() => {
      expect([...result.current.keys()]).toEqual(['gcd']);
    });
  });

  it('measures one example at a time, showing each card as its run lands', async () => {
    stubFetch(exampleRoutes());
    const entries = [FACTORIAL, GCD];
    const held = heldRuns();
    const { result } = renderHook(() => useExamplePreviews(entries, held.runner));

    await waitFor(() => {
      expect(held.signals).toHaveLength(1);
    });
    expect(result.current.size).toBe(0);

    held.release();
    await waitFor(() => {
      expect([...result.current.keys()]).toEqual(['factorial']);
    });
    expect(held.signals).toHaveLength(2);

    held.release();
    await waitFor(() => {
      expect([...result.current.keys()]).toEqual(['factorial', 'gcd']);
    });
  });

  it('stops the queue and the run in flight when the screen goes away', async () => {
    stubFetch(exampleRoutes());
    const entries = [FACTORIAL, GCD];
    const held = heldRuns();
    const { unmount } = renderHook(() => useExamplePreviews(entries, held.runner));

    await waitFor(() => {
      expect(held.signals).toHaveLength(1);
    });

    unmount();
    expect(held.signals[0]?.aborted).toBe(true);

    held.release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(held.signals).toHaveLength(1);
  });

  it('drops the answer to a superseded list when it lands late', async () => {
    let land: (response: Response) => void = () => undefined;
    const heldFactorial = new Promise<Response>((resolve) => {
      land = resolve;
    });
    stubFetch({ ...exampleRoutes(), [exampleUrl('Factorial.class')]: () => heldFactorial });

    const { result, rerender } = renderHook(
      ({ entries }: { entries: readonly ExampleEntry[] }) =>
        useExamplePreviews(entries, inlineRunner),
      { initialProps: { entries: [FACTORIAL] } },
    );

    rerender({ entries: [GCD] });
    await waitFor(() => {
      expect([...result.current.keys()]).toEqual(['gcd']);
    });

    await act(async () => {
      land(okResponse({ bytes: readExampleBytes('Factorial.class') }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect([...result.current.keys()]).toEqual(['gcd']);
  });

  it('aborts a preview download when the screen goes away', () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    });
    const entries = [FACTORIAL];

    const { unmount } = renderHook(() => useExamplePreviews(entries, inlineRunner));
    expect(signal?.aborted).toBe(false);
    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('clears previews when the catalogue is replaced by an empty one', async () => {
    stubFetch(exampleRoutes());
    const entries: readonly ExampleEntry[] = [FACTORIAL];
    const { result, rerender } = renderHook(
      ({ entries }: { entries: readonly ExampleEntry[] }) =>
        useExamplePreviews(entries, inlineRunner),
      { initialProps: { entries } },
    );
    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    rerender({ entries: NO_ENTRIES });

    expect(result.current.size).toBe(0);
  });
});
