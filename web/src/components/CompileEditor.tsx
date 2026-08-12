import { useRef } from 'react';

import { useDialogFocus } from '../hooks/useDialogFocus';
import type { CompileDiagnostic, DiagnosticKind } from '../services/compile-client';

import { Button } from './ui/Button';

export const SEED_SOURCE = `public class FizzBuzz {

    public static void main(String[] args) {
        int result = 0;
        for (int n = 1; n <= 15; n++) {
            // Dense labels, so javac compiles this to a tableswitch.
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
  readonly isCompiling: boolean;
  readonly onCompile: () => void;
  readonly onClose: () => void;
}

const KIND_STYLE: Record<DiagnosticKind, string> = {
  error: 'text-error',
  warning: 'text-warn',
  note: 'text-fg-2',
};

export function CompileEditor({
  source,
  onSourceChange,
  diagnostics,
  isCompiling,
  onCompile,
  onClose,
}: CompileEditorProps) {
  const editorRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useDialogFocus(editorRef, onClose, { initialFocus: textareaRef });

  return (
    <section
      ref={editorRef}
      role="region"
      aria-label="Java editor"
      data-testid="compile-editor"
      className="col-span-full row-span-full flex min-h-0 flex-col rounded-panel bg-panel shadow-panel"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="text-title font-medium text-fg">Write Java</h2>
        <div className="flex items-baseline gap-3">
          <span className="hidden font-mono text-meta text-fg-3 sm:inline">
            javac on the server · executed in this tab
          </span>
          <Button tone="raised" onClick={onClose} className="shrink-0">
            Close
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pb-3.5">
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
          className="focus-ring scroll-slim min-h-0 flex-1 resize-none rounded-row bg-raised px-3.5 py-2.5 font-mono text-code whitespace-pre text-fg-2 shadow-panel"
        />

        <div aria-live="polite" className="max-h-[35%] shrink-0 overflow-auto scroll-slim">
          {diagnostics.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${String(diagnostic.line)}:${String(index)}`}
                  data-testid="compile-diagnostic"
                  data-kind={diagnostic.kind}
                  className={`flex items-baseline gap-3 rounded-row bg-raised px-3 py-2 text-label ${KIND_STYLE[diagnostic.kind]}`}
                >
                  <span className="shrink-0 font-mono text-meta text-fg-3">
                    {positionOf(diagnostic)}
                  </span>
                  <span className="grow">{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Button tone="prominent" onClick={onCompile} disabled={isCompiling} className="shrink-0">
            {isCompiling ? 'Compiling…' : 'Compile'}
          </Button>
          <span className="text-label text-fg-3">
            Static methods called from <span className="font-mono">main</span>: ints, int arrays,{' '}
            <span className="font-mono">Math</span> and{' '}
            <span className="font-mono">System.out</span>, nothing else.
          </span>
        </div>
      </div>
    </section>
  );
}

function positionOf(diagnostic: CompileDiagnostic): string {
  if (diagnostic.line === undefined) {
    return '–';
  }
  return diagnostic.column === undefined
    ? String(diagnostic.line)
    : `${String(diagnostic.line)}:${String(diagnostic.column)}`;
}
