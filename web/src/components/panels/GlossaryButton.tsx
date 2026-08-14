import { glossaryEntry, type GlossaryTermId } from '../../services/views/glossary';
import { openGlossary } from '../../services/session/glossary-store';

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
      className="focus-ring group -mx-1 flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-control"
    >
      <span
        aria-hidden="true"
        // eslint-disable-next-line no-restricted-syntax -- genuinely circular: the 16px badge
        className="flex h-4 w-4 items-center justify-center rounded-full bg-raised text-micro leading-none text-fg-3 transition-colors duration-150 group-hover:bg-raised-active group-hover:text-fg"
      >
        ?
      </span>
      <span className="sr-only">{question}</span>
    </button>
  );
}

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
      aria-label={`${text}: ${question}`}
      onClick={() => {
        openGlossary(term);
      }}
      className="focus-ring rounded-chip underline decoration-fg-dim decoration-dotted underline-offset-[3px] transition-colors duration-150 hover:text-fg-2 hover:decoration-fg-2"
    >
      {text}
    </button>
  );
}
