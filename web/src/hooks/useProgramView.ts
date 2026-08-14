import { useMemo } from 'react';

import type { Snapshot } from '../core/interpreter';
import type { LoadedProgram, MethodListing } from '../services/loading/program';
import {
  historyViewOf,
  listingViewOf,
  stepViewOf,
  type ProgramView,
} from '../services/views/program-view';

export function useProgramView(
  program: LoadedProgram | undefined,
  snapshot: Snapshot | undefined,
  listing: MethodListing | undefined,
): ProgramView {
  const history = useMemo(() => historyViewOf(program), [program]);

  return {
    ...history,
    ...listingViewOf(program, listing),
    ...stepViewOf(program, snapshot, listing, history.printed),
  };
}
