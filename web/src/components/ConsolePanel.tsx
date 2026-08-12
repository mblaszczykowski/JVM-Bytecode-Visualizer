import { rowTopOf, useScrollFollow } from '../hooks/useScrollFollow';

import { EmptyState, Panel } from './Panel';

export interface ConsolePanelProps {
  readonly lines: readonly string[];
}

const LINE =
  'flex h-[26px] shrink-0 items-center rounded-code px-2 font-mono text-code whitespace-pre';

export function ConsolePanel({ lines }: ConsolePanelProps) {
  const newestIndex = lines.length - 1;
  const contentRef = useScrollFollow(rowTopOf(lines.length === 0 ? undefined : newestIndex));

  return (
    <div data-testid="console-panel" className="flex min-h-0 grow flex-col">
      <Panel
        title="Console"
        meta={lines.length === 1 ? '1 line' : `${String(lines.length)} lines`}
        variant="state"
        className="grow"
        contentRef={contentRef}
      >
        {lines.length === 0 ? (
          <EmptyState
            status="nothing printed yet"
            detail="The first System.out.println the run reaches writes a line here."
          />
        ) : (
          <ol className="px-2.5 pb-0.5">
            {lines.map((line, index) => {
              const isNewest = index === newestIndex;

              return (
                <li
                  key={index}
                  data-testid="console-line"
                  data-current={isNewest ? 'true' : undefined}
                  aria-current={isNewest ? 'true' : undefined}
                  className={`${LINE} ${isNewest ? 'now-row text-accent-text' : 'text-fg-2'}`}
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
