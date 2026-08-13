import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useOpenGlossaryTerm } from '../../hooks/useOpenGlossaryTerm';
import { GLOSSARY, glossaryEntry, type GlossaryTermId } from '../../services/views/glossary';
import { closeGlossary } from '../../services/views/glossary-store';

import { Button } from '../ui/Button';

function Prose({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          <code key={index} className="font-mono text-label text-fg">
            {part}
          </code>
        ),
      )}
    </>
  );
}

interface TermButtonProps {
  readonly term: GlossaryTermId;
  readonly selected: boolean;
  readonly onSelect: (term: GlossaryTermId) => void;
  readonly className?: string;
  readonly children: ReactNode;
}

function TermButton({ term, selected, onSelect, className = '', children }: TermButtonProps) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        onSelect(term);
      }}
      className={`focus-ring shrink-0 rounded-control px-2.5 text-left text-label transition-colors duration-150 ${
        selected
          ? 'bg-raised-active text-fg shadow-control-raised'
          : 'text-fg-3 hover:bg-raised hover:text-fg'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function GlossarySheet({ initialTerm }: { readonly initialTerm: GlossaryTermId }) {
  const [termId, setTermId] = useState<GlossaryTermId>(initialTerm);
  const sheetRef = useRef<HTMLDivElement>(null);
  const entry = glossaryEntry(termId);

  useDialogFocus(sheetRef, closeGlossary);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-7">
      <div aria-hidden="true" onClick={closeGlossary} className="absolute inset-0 bg-scrim" />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        data-testid="glossary"
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-panel bg-overlay shadow-overlay outline-none"
      >
        <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pt-4 pb-3">
          <h2 id="glossary-title" className="text-title font-medium tracking-[-0.015em] text-fg">
            Glossary
          </h2>
          <div className="flex items-baseline gap-3">
            <span className="hidden font-mono text-meta text-fg-3 sm:inline">
              terms used on these panels
            </span>
            <Button tone="raised" onClick={closeGlossary} className="shrink-0">
              Close
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pb-3.5 md:flex-row md:gap-3.5">
          <nav
            aria-label="Glossary terms"
            className="scroll-slim flex shrink-0 gap-1 overflow-x-auto pb-0.5 md:w-[178px] md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:pb-0"
          >
            {GLOSSARY.map((term) => (
              <TermButton
                key={term.id}
                term={term.id}
                selected={term.id === termId}
                onSelect={setTermId}
                className="py-2 whitespace-nowrap md:py-1 md:whitespace-normal"
              >
                {term.term}
              </TermButton>
            ))}
          </nav>

          <article
            data-testid="glossary-entry"
            data-term={entry.id}
            className="scroll-slim min-h-0 flex-1 overflow-auto rounded-panel bg-raised px-4 py-3.5 shadow-panel"
          >
            <h3 className="text-brand font-medium text-fg">{entry.term}</h3>

            {entry.paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-2.5 text-body text-fg-2">
                <Prose text={paragraph} />
              </p>
            ))}

            <div className="mt-3.5 flex flex-wrap items-baseline gap-1.5">
              <span className="text-meta text-fg-3">See also</span>
              {entry.related.map((related) => (
                <TermButton
                  key={related}
                  term={related}
                  selected={false}
                  onSelect={setTermId}
                  className="bg-raised py-0.5"
                >
                  {glossaryEntry(related).term}
                </TermButton>
              ))}
            </div>

            <p className="mt-2.5 text-meta text-fg-3">
              More detail in <code className="font-mono text-fg-2">docs/jvm-primer.md</code> §
              {entry.primer.section}, <Prose text={entry.primer.title} />, with worked examples and
              the <code className="font-mono text-fg-2">javap</code> output to check it against.
            </p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GlossaryDialog() {
  const openTerm = useOpenGlossaryTerm();

  return openTerm === undefined ? null : <GlossarySheet key={openTerm} initialTerm={openTerm} />;
}
