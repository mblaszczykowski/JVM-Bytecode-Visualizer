import { useEffect, type Dispatch } from 'react';

import type { AppAction } from '../services/loading/app-state';
import { checkHealth } from '../services/loading/compile-client';

export function useCompilerHealth(
  baseUrl: string | undefined,
  dispatch: Dispatch<AppAction>,
): void {
  useEffect(() => {
    if (baseUrl === undefined) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    void checkHealth(baseUrl, controller.signal).then(
      (healthy) => {
        if (active) {
          dispatch({ kind: 'compiler-checked', healthy });
        }
      },
      () => {
        if (active) {
          dispatch({ kind: 'compiler-checked', healthy: false });
        }
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [baseUrl, dispatch]);
}
