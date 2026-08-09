import { useSyncExternalStore } from 'react';

import type { GlossaryTermId } from '../services/glossary';

let openTerm: GlossaryTermId | undefined;

const listeners = new Set<() => void>();

const FIRST_TERM: GlossaryTermId = 'operand-stack';

export function openGlossary(term: GlossaryTermId = FIRST_TERM): void {
  openTerm = term;
  for (const listener of listeners) {
    listener();
  }
}

export function closeGlossary(): void {
  openTerm = undefined;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function serverSnapshot(): GlossaryTermId | undefined {
  return undefined;
}

export function useOpenGlossaryTerm(): GlossaryTermId | undefined {
  return useSyncExternalStore(subscribe, () => openTerm, serverSnapshot);
}
