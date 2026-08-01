import { useSyncExternalStore } from 'react';

import type { GlossaryTermId } from '../services/glossary';

/**
 * Which glossary entry is open, if any.
 *
 * Deliberately a module-level store rather than state passed down: the triggers sit in panel
 * headers, in a panel's metadata line and on the welcome screen, and there is exactly one
 * dialog behind all of them. Threading a callback to each would put a glossary prop on
 * components that otherwise have no idea the glossary exists.
 */
let openTerm: GlossaryTermId | undefined;

const listeners = new Set<() => void>();

/** Where the dialog opens when the reader asked for the glossary rather than for one term. */
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
