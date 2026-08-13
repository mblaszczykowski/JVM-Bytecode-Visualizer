import { useEffect, type Dispatch } from 'react';

import type { AppAction } from '../services/app-state';
import { checkHealth } from '../services/compile-client';

export function useCompilerHealth(
  baseUrl: string | undefined,
  dispatch: Dispatch<AppAction>,
): void {
  useEffect(() => {
    if (baseUrl === undefined) {
      return;
    }
    let active = true;
    void checkHealth(baseUrl).then(
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
    };
  }, [baseUrl, dispatch]);
}
