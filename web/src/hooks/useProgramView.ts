import { useMemo } from 'react';

import type { Snapshot } from '../core/interpreter/types';
import type { LoadedProgram, MethodListing } from '../services/program';
import {
  historyViewOf,
  listingViewOf,
  stepViewOf,
  type ProgramView,
} from '../services/program-view';

export function useProgramView(
  program: LoadedProgram | undefined,
  snapshot: Snapshot | undefined,
  listing: MethodListing | undefined,
): ProgramView {
  const history = useMemo(() => historyViewOf(program), [program]);
  const forListing = useMemo(() => listingViewOf(program, listing), [program, listing]);
  const step = useMemo(
    () => stepViewOf(program, snapshot, listing, history.printed),
    [program, snapshot, listing, history.printed],
  );

  return useMemo(() => ({ ...history, ...forListing, ...step }), [history, forListing, step]);
}
