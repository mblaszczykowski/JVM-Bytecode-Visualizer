import { glossaryEntry, type GlossaryTermId } from '../services/glossary';

import { openGlossary } from './glossary-store';

/**
 * The affordance in a panel header: a 16px mark that opens the glossary at the concept the
 * panel is drawing. Quiet enough to disappear into the header, and the only thing on the
 * screen shaped like a question.
 *
 * The glyph is hidden from the accessible tree so the button is announced as the question it
 * asks — "?" as an accessible name would be no name at all.
 */
export function GlossaryButton({ term }: { readonly term: GlossaryTermId }) {
  const { question } = glossaryEntry(term);

  return (
    <button
      type="button"
      data-testid="glossary-trigger"
      data-term={term}
      title={question}
      onClick={() => {
        openGlossary(term);
      }}
      className="focus-ring flex h-4 w-4 shrink-0 items-center justify-center self-center rounded-full bg-raised text-micro leading-none text-fg-3 transition-colors duration-150 hover:bg-raised-active hover:text-fg"
    >
      <span aria-hidden="true">?</span>
      <span className="sr-only">{question}</span>
    </button>
  );
}

/**
 * The same door, on a piece of text that *is* the term — a method descriptor in a panel's
 * metadata, say. It keeps the type and colour of its surroundings and adds only the dotted
 * underline, because the notation itself has to stay readable as notation.
 */
export function GlossaryLink({
  term,
  text,
}: {
  readonly term: GlossaryTermId;
  readonly text: string;
}) {
  const { question } = glossaryEntry(term);

  return (
    <button
      type="button"
      data-testid="glossary-trigger"
      data-term={term}
      title={question}
      // The name leads with the notation it sits on, so it still says where it is.
      aria-label={`${text} — ${question}`}
      onClick={() => {
        openGlossary(term);
      }}
      className="focus-ring rounded-[3px] underline decoration-fg-dim decoration-dotted underline-offset-[3px] transition-colors duration-150 hover:text-fg-2 hover:decoration-fg-2"
    >
      {text}
    </button>
  );
}
