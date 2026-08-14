import { useSyncExternalStore } from 'react';

import type { GlossaryTermId } from '../services/views/glossary';
import {
  noGlossaryTerm,
  openGlossaryTerm,
  subscribeToGlossary,
} from '../services/session/glossary-store';

export function useOpenGlossaryTerm(): GlossaryTermId | undefined {
  return useSyncExternalStore(subscribeToGlossary, openGlossaryTerm, noGlossaryTerm);
}
