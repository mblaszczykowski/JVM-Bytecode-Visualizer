import { useSyncExternalStore } from 'react';

import type { GlossaryTermId } from '../services/views/glossary';
import {
  noGlossaryTerm,
  openGlossaryTerm,
  subscribeToGlossary,
} from '../services/views/glossary-store';

export function useOpenGlossaryTerm(): GlossaryTermId | undefined {
  return useSyncExternalStore(subscribeToGlossary, openGlossaryTerm, noGlossaryTerm);
}
