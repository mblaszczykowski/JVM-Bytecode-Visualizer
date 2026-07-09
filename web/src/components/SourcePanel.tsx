import { Panel } from './Panel';
import { CODE, CURRENT_ROW, GUTTER, GUTTER_CURRENT, IDLE_ROW, ROW } from './theme';

interface SourcePanelProps {
  readonly fileName: string;
  /** Linie pliku `.java`; indeks 0 to linia 1. */
  readonly lines: readonly string[];
  /**
   * Numer linii (1-indeksowany) z `Snapshot.sourceLine`; `undefined`, gdy bieżący snapshot
   * nie ma mapowania (m.in. snapshot terminalny).
   */
  readonly currentLine: number | undefined;
}

export function SourcePanel({ fileName, lines, currentLine }: SourcePanelProps) {
  return (
    <Panel title="Źródło" meta={fileName}>
      <ol className="px-[10px]">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isCurrent = lineNumber === currentLine;

          return (
            <li
              key={lineNumber}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={isCurrent ? 'current-source-line' : 'source-line'}
              className={`${ROW} ${CODE} ${isCurrent ? CURRENT_ROW : IDLE_ROW}`}
            >
              <span className={isCurrent ? GUTTER_CURRENT : GUTTER}>{lineNumber}</span>
              <span className="grow">{line}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
