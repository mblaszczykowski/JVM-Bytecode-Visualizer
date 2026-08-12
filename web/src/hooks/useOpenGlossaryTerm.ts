import { useSyncExternalStore } from 'react';

import type { GlossaryTermId } from '../services/glossary';
import { noGlossaryTerm, openGlossaryTerm, subscribeToGlossary } from '../services/glossary-store';

export function useOpenGlossaryTerm(): GlossaryTermId | undefined {
  return useSyncExternalStore(subscribeToGlossary, openGlossaryTerm, noGlossaryTerm);
}
