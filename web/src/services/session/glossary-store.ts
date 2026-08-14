import type { GlossaryTermId } from '../views/glossary';

const FIRST_TERM: GlossaryTermId = 'operand-stack';

const listeners = new Set<() => void>();

let openTerm: GlossaryTermId | undefined;

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openGlossary(term: GlossaryTermId = FIRST_TERM): void {
  openTerm = term;
  announce();
}

export function closeGlossary(): void {
  openTerm = undefined;
  announce();
}

export function openGlossaryTerm(): GlossaryTermId | undefined {
  return openTerm;
}

export function noGlossaryTerm(): undefined {
  return undefined;
}

export function subscribeToGlossary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetGlossary(): void {
  openTerm = undefined;
  listeners.clear();
}
