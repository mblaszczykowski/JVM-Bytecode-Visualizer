import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleRoutes, statusResponse, stubFetch } from '../services/__fixtures__/fake-fetch';
import { exampleUrl } from '../services/examples';
import type { ExampleEntry } from '../services/manifest';

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

const NO_ENTRIES: readonly ExampleEntry[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useExamplePreviews', () => {
  it('has nothing to show before the manifest arrives', () => {
    stubFetch(exampleRoutes());
    const { result } = renderHook(() => useExamplePreviews(NO_ENTRIES));

    expect(result.current.size).toBe(0);
  });

  it('runs each example once and keeps its shape, keyed by id', async () => {
    stubFetch(exampleRoutes());
    const entries = [FACTORIAL];
    const { result } = renderHook(() => useExamplePreviews(entries));

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    const preview = result.current.get('factorial');
    expect(preview?.steps).toBe(40);
    expect(preview?.maxDepth).toBe(5);
    expect(preview?.profile.length).toBeGreaterThan(0);
  });

  it('leaves out an example whose class file cannot be downloaded', async () => {
    const entries = [FACTORIAL];
    stubFetch({
      ...exampleRoutes(),
      [exampleUrl('Factorial.class')]: () => statusResponse(404),
    });

    const { result } = renderHook(() => useExamplePreviews(entries));

    await waitFor(() => {
      expect(result.current.size).toBe(0);
    });
  });

  it('drops a late answer once it has been unmounted', async () => {
    stubFetch(exampleRoutes());
    const entries = [FACTORIAL];
    const { result, unmount } = renderHook(() => useExamplePreviews(entries));

    unmount();
    await Promise.resolve();

    expect(result.current.size).toBe(0);
  });
});
