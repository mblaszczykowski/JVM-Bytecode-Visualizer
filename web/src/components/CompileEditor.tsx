import { useEffect, useRef } from 'react';

import type { CompileDiagnostic, DiagnosticKind } from '../services/compile-client';

/**
 * Seed program: the first thing a visitor compiles, so it spans the executable subset rather
 * than sitting in a corner of it — a loop, a switch, string constants and printing. The last
 * of those earns its place twice over: the console section joins the state column only for a
 * run that printed, so a seed that stays silent is a seed that hides a panel.
 *
 * `result` is not incidental either: a run's summary reports the local of that name.
 */
export const SEED_SOURCE = `public class FizzBuzz {

    public static void main(String[] args) {
        int result = 0;
        for (int n = 1; n <= 15; n++) {
            // Dense labels, so javac reaches for tableswitch rather than lookupswitch.
            switch (n % 15) {
                case 0 -> System.out.println("FizzBuzz");
                case 3, 6, 9, 12 -> System.out.println("Fizz");
                case 5, 10 -> System.out.println("Buzz");
                default -> {
                    System.out.println(n);
                    result = result + n;
                }
            }
        }
        System.out.println(result);
    }
}
`;

interface CompileEditorProps {
  readonly source: string;
  readonly onSourceChange: (source: string) => void;
  readonly diagnostics: readonly CompileDiagnostic[];
  /** Compile is in flight: the button is busy and the text stays editable. */
  readonly isCompiling: boolean;
  readonly onCompile: () => void;
  readonly onClose: () => void;
}

const KIND_STYLE: Record<DiagnosticKind, string> = {
  error: 'text-error',
  warning: 'text-warn',
  note: 'text-white/60',
};

/**
 * Plain textarea rather than an embedded IDE: the class this compiles is twenty lines long,
 * and a code editor would cost more bytes than the rest of the application.
 *
 * The transport keeps its keyboard shortcuts while this is open — they step aside for text
 * entry on their own, which is exactly the case the guard exists for.
 */
export function CompileEditor({
  source,
  onSourceChange,
  diagnostics,
  isCompiling,
  onCompile,
  onClose,
}: CompileEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <section
      role="region"
      aria-label="Java editor"
      data-testid="compile-editor"
      className="col-span-full row-span-full flex min-h-0 flex-col rounded-panel bg-panel/[0.045] shadow-panel"
    >
      <header className="flex shrink-0 items-baseline justify-between gap-3 px-[18px] pt-[14px] pb-[10px]">
        <h2 className="text-title font-medium text-white/80">Write Java</h2>
        <div className="flex items-baseline gap-3">
          <span className="hidden font-mono text-meta text-white/32 sm:inline">
            javac on the server · executed in this tab
          </span>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring shrink-0 rounded-full bg-white/9 px-3 py-1 text-label text-white/70 transition-colors hover:bg-white/15"
          >
            Close
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[10px] px-[14px] pb-[14px]">
        <textarea
          ref={textareaRef}
          value={source}
          onChange={(event) => {
            onSourceChange(event.target.value);
          }}
          aria-label="Java source"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="focus-ring scroll-slim min-h-0 flex-1 resize-none rounded-row bg-white/[0.03] px-[14px] py-[10px] font-mono text-code leading-[26px] whitespace-pre text-white/75 shadow-panel"
        />

        <div aria-live="polite" className="max-h-[35%] shrink-0 overflow-auto scroll-slim">
          {diagnostics.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${String(diagnostic.line)}:${String(index)}`}
                  data-testid="compile-diagnostic"
                  data-kind={diagnostic.kind}
                  className={`flex items-baseline gap-3 rounded-row bg-white/5 px-[13px] py-[9px] text-label ${KIND_STYLE[diagnostic.kind]}`}
                >
                  <span className="shrink-0 font-mono text-meta text-white/32">
                    {positionOf(diagnostic)}
                  </span>
                  <span className="grow">{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onCompile}
            disabled={isCompiling}
            className="focus-ring shrink-0 rounded-full bg-white/9 px-4 py-1.5 text-label text-white/85 shadow-control-raised transition-colors hover:bg-white/15 disabled:opacity-40"
          >
            {isCompiling ? 'Compiling…' : 'Compile'}
          </button>
          <span className="text-label text-white/55">
            Static methods called from <span className="font-mono">main</span> — ints, int arrays,{' '}
            <span className="font-mono">Math</span> and{' '}
            <span className="font-mono">System.out</span>, nothing else.
          </span>
        </div>
      </div>
    </section>
  );
}

/** `12:5` when javac placed the diagnostic, `—` when it had no position at all. */
function positionOf(diagnostic: CompileDiagnostic): string {
  if (diagnostic.line === undefined) {
    return '—';
  }
  return diagnostic.column === undefined
    ? String(diagnostic.line)
    : `${String(diagnostic.line)}:${String(diagnostic.column)}`;
}
