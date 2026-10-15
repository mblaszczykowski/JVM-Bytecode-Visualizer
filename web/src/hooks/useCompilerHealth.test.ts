import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCompilerHealth } from './useCompilerHealth';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCompilerHealth', () => {
  it('aborts the health request on unmount without dispatching its cancellation', async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    });
    const dispatch = vi.fn();
    const { unmount } = renderHook(() => {
      useCompilerHealth('https://compile.test', dispatch);
    });
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(signal?.aborted).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
