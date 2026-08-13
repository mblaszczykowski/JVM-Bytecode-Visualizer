import { useEffect, type Dispatch } from 'react';

import type { AppAction } from '../services/app-state';
import { toAppError } from '../services/errors';
import { fetchExampleManifest } from '../services/examples';

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
