import { Panel } from './Panel';
import { useScrollFollow } from './useScrollFollow';

export interface ConsolePanelProps {
  /** Every line the program has printed up to the current step. Cumulative, so it only grows. */
  readonly lines: readonly string[];
}

/**
 * One printed line, at the same fixed row height as a line of code.
 *
 * `whitespace-pre` rather than `pre-wrap`: the spaces a program printed are part of its output
 * and must survive, but a wrapped line would be two rows tall, and both the rhythm of the
 * column and the index-to-`scrollTop` arithmetic of the scroll-follow assume one row per line.
 * An over-long line scrolls sideways inside the panel body, exactly as a code row does.
 */
const LINE =
  'flex h-[26px] shrink-0 items-center rounded-code px-2 font-mono text-[12.5px] whitespace-pre';

/**
 * What the program wrote to `System.out`, in the order it wrote it.
 *
 * The newest line is the one the reader is watching — it carries the accent, because at this
 * step it is the state of the console, and every line above it is settled output.
 */
export function ConsolePanel({ lines }: ConsolePanelProps) {
  const newestIndex = lines.length - 1;
  const contentRef = useScrollFollow(lines.length === 0 ? undefined : newestIndex);

  return (
    // The panel frame owns its own `<section>`, so the identity hook the column and the tests
    // address the section by lives on a wrapper rather than inside the shared frame.
    <div data-testid="console-panel" className="flex min-h-0 flex-col">
      <Panel
        title="Console"
        meta={lines.length === 1 ? '1 line' : `${String(lines.length)} lines`}
        variant="state"
        bodyFill="short"
        contentRef={contentRef}
      >
        {lines.length === 0 ? (
          <p className="px-[23px] py-2 text-[12px] text-white/55">nothing printed yet</p>
        ) : (
          <ol className="px-[10px] pb-[2px]">
            {lines.map((line, index) => {
              const isNewest = index === newestIndex;

              return (
                <li
                  // Output is append-only: a line's position in the run is its identity.
                  key={index}
                  data-testid="console-line"
                  data-current={isNewest ? 'true' : undefined}
                  // The highlight is not carried by colour alone, so the newest line is
                  // announced as the current one too.
                  aria-current={isNewest ? 'true' : undefined}
                  className={`${LINE} ${
                    isNewest ? 'bg-accent/[0.22] text-accent-text shadow-current' : 'text-white/60'
                  }`}
                >
                  {line}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
