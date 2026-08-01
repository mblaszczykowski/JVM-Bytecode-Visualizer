import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { GLOSSARY, glossaryEntry, type GlossaryTermId } from '../services/glossary';

import { closeGlossary, useOpenGlossaryTerm } from './glossary-store';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keys the transport listens for on the window; while this is open they belong to the dialog. */
const TRANSPORT_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

/**
 * Backticks in the entry text are code, the same convention the primer is written in. Nothing
 * else is marked up: an explanation that needs more than that is too long for a glossary.
 */
function Prose({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, index) =>
        index % 2 === 0 ? (
          part
        ) : (
          <code key={index} className="font-mono text-[11.5px] text-white/85">
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
      className={`focus-ring shrink-0 rounded-full px-[11px] text-left text-[11.5px] transition-colors ${
        selected
          ? 'bg-white/[0.16] text-white/90 shadow-control-raised'
          : 'text-white/55 hover:bg-white/8 hover:text-white/80'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * The glossary itself: the term list beside the entry, over a scrim.
 *
 * Mounted fresh on every open (see `GlossaryDialog`), so the selected term, the scroll
 * position and the focus all start from the door the reader came through.
 */
function GlossarySheet({ initialTerm }: { readonly initialTerm: GlossaryTermId }) {
  const [termId, setTermId] = useState<GlossaryTermId>(initialTerm);
  const sheetRef = useRef<HTMLDivElement>(null);
  const entry = glossaryEntry(termId);

  useEffect(() => {
    // Captured before anything is focused, so closing hands the reader back to the panel
    // header, the metadata line or the welcome screen they opened this from.
    const opener = document.activeElement;
    sheetRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    /**
     * One capture-phase listener does all three jobs a modal owes the keyboard: an escape
     * route, a Tab cycle that cannot leave, and silence for the shortcuts underneath — the
     * transport listens on the window and would otherwise scrub the run behind the dialog.
     */
    function handleKeyDown(event: KeyboardEvent): void {
      const sheet = sheetRef.current;
      if (sheet === null) {
        return;
      }

      if (event.key === 'Escape') {
        event.stopPropagation();
        closeGlossary();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first === undefined || last === undefined) {
          return;
        }
        const leaving = event.shiftKey
          ? document.activeElement === first || document.activeElement === sheet
          : document.activeElement === last;
        if (leaving) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
        return;
      }

      if (TRANSPORT_KEYS.has(event.key)) {
        event.stopPropagation();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[16px] sm:p-[28px]">
      <div aria-hidden="true" onClick={closeGlossary} className="absolute inset-0 bg-black/60" />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-title"
        data-testid="glossary"
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-shell bg-app/95 shadow-shell outline-none"
      >
        <header className="flex shrink-0 items-baseline justify-between gap-3 px-[18px] pt-[16px] pb-[12px]">
          <h2
            id="glossary-title"
            className="text-[13.5px] font-semibold tracking-[-0.015em] text-white/95"
          >
            Glossary
          </h2>
          <div className="flex items-baseline gap-3">
            <span className="hidden font-mono text-[11px] text-white/32 sm:inline">
              the words on these panels
            </span>
            <button
              type="button"
              onClick={closeGlossary}
              className="focus-ring shrink-0 rounded-full bg-white/9 px-3 py-1 text-[11.5px] text-white/70 transition-colors hover:bg-white/15"
            >
              Close
            </button>
          </div>
        </header>

        {/* One row of terms on a phone, a column beside the entry from `md` up. */}
        <div className="flex min-h-0 flex-1 flex-col gap-[10px] px-[14px] pb-[14px] md:flex-row md:gap-[14px]">
          <nav
            aria-label="Glossary terms"
            className="scroll-slim flex shrink-0 gap-[5px] overflow-x-auto pb-[2px] md:w-[178px] md:flex-col md:gap-[2px] md:overflow-x-visible md:overflow-y-auto md:pb-0"
          >
            {GLOSSARY.map((term) => (
              <TermButton
                key={term.id}
                term={term.id}
                selected={term.id === termId}
                onSelect={setTermId}
                className="py-[8px] whitespace-nowrap md:py-[5px] md:whitespace-normal"
              >
                {term.term}
              </TermButton>
            ))}
          </nav>

          <article
            data-testid="glossary-entry"
            data-term={entry.id}
            className="scroll-slim min-h-0 flex-1 overflow-auto rounded-panel bg-white/[0.045] px-[18px] py-[15px] shadow-panel"
          >
            <h3 className="text-[15px] font-semibold text-white/90">{entry.term}</h3>

            {entry.paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-[10px] text-[12.5px] leading-[20px] text-white/60">
                <Prose text={paragraph} />
              </p>
            ))}

            <div className="mt-[14px] flex flex-wrap items-baseline gap-[6px]">
              <span className="text-[11px] text-white/32">See also</span>
              {entry.related.map((related) => (
                <TermButton
                  key={related}
                  term={related}
                  selected={false}
                  onSelect={setTermId}
                  className="bg-white/6 py-[3px]"
                >
                  {glossaryEntry(related).term}
                </TermButton>
              ))}
            </div>

            {/* The long form is the authority; this is its abstract. */}
            <p className="mt-[10px] text-[11px] leading-[16px] text-white/45">
              Full treatment in <code className="font-mono text-white/60">docs/jvm-primer.md</code>{' '}
              §{entry.primer.section} — <Prose text={entry.primer.title} />, with the worked
              examples and the <code className="font-mono text-white/60">javap</code> output to
              check it against.
            </p>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Mounted once, from the toolbar, because the toolbar is the one thing on screen in every
 * state of the application. The doors into it are everywhere the words are: panel headers, a
 * method descriptor, the welcome screen.
 */
export function GlossaryDialog() {
  const openTerm = useOpenGlossaryTerm();

  return openTerm === undefined ? null : <GlossarySheet key={openTerm} initialTerm={openTerm} />;
}
