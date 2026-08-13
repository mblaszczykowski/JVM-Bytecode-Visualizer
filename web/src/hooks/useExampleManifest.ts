import { useEffect, type Dispatch } from 'react';

import type { AppAction } from '../services/loading/app-state';
import { toAppError } from '../services/loading/errors';
import { fetchExampleManifest } from '../services/loading/examples';

export function useExampleManifest(dispatch: Dispatch<AppAction>): void {
  useEffect(() => {
    let active = true;
    void fetchExampleManifest().then(
      (manifest) => {
        if (active) {
          dispatch({ kind: 'examples-loaded', entries: manifest.examples });
        }
      },
      (error: unknown) => {
        if (active) {
          dispatch({ kind: 'examples-failed', error: toAppError(error) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [dispatch]);
}
