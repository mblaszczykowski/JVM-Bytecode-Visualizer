import { CurrentRowHighlight } from './CurrentRowHighlight';
import { Panel } from './Panel';
import { CODE_ROW } from './rhythm';
import { TOKEN_CLASS, tokenizeJava } from './syntax';
import { Pill } from './ui/Pill';
import { useScrollFollow } from './useScrollFollow';

interface SourcePanelProps {
  readonly fileName: string;
  /** Lines of the `.java` file; index 0 is line 1. */
  readonly lines: readonly string[];
  /**
   * 1-based line number from `Snapshot.sourceLine`; `undefined` when the snapshot has no
   * mapping (the terminal snapshot, among others).
   */
  readonly currentLine: number | undefined;
  /** Byte offsets covered by the current line, rendered as `pc 7–15`. */
  readonly pcRange?: { readonly from: number; readonly to: number } | undefined;
  /** How the current line was chosen — spells out the LineNumberTable rule. */
  readonly lineMappingNote?: string | undefined;
  /** Slide the highlight between lines; switched off above 4× playback. */
  readonly animateHighlight?: boolean;
  readonly className?: string;
}

export function SourcePanel({
  fileName,
  lines,
  currentLine,
  pcRange,
  lineMappingNote,
  animateHighlight = false,
  className = '',
}: SourcePanelProps) {
  const currentIndex = currentLine === undefined ? undefined : currentLine - 1;
  const isMapped = currentIndex !== undefined && currentIndex >= 0 && currentIndex < lines.length;
  const contentRef = useScrollFollow(isMapped ? currentIndex : undefined);

  // Anything that does not fit on a code row goes to the footer rather than growing the row.
  const footer = !isMapped ? undefined : (
    <div className="flex flex-wrap items-center gap-[10px]">
      {pcRange === undefined ? null : (
        <Pill tone="accent">
          pc {pcRange.from}–{pcRange.to}
        </Pill>
      )}
      {lineMappingNote === undefined ? null : (
        <span className="font-mono text-[10.5px] text-white/55">{lineMappingNote}</span>
      )}
    </div>
  );

  return (
    <Panel
      title="Source"
      meta={fileName}
      contentRef={contentRef}
      footer={footer}
      className={className}
    >
      {/* `isolate` keeps the highlight's negative z-index from sinking below the panel. */}
      <ol className="isolate px-[10px]">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isCurrent = lineNumber === currentLine;

          return (
            <li
              key={lineNumber}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={isCurrent ? 'current-source-line' : 'source-line'}
              className={`${CODE_ROW} ${isCurrent ? 'text-accent-text' : 'text-white/60'}`}
            >
              {isCurrent ? (
                <CurrentRowHighlight layoutId="source-highlight" animate={animateHighlight} />
              ) : null}
              <span
                className={`w-7 shrink-0 text-right select-none ${
                  isCurrent ? 'text-accent-dim' : 'text-white/24'
                }`}
              >
                {lineNumber}
              </span>
              <span className="grow">
                {tokenizeJava(line).map((token, tokenIndex) => (
                  <span
                    // Tokens are positional within a line; there is no stabler key than the index.
                    key={`${String(tokenIndex)}:${token.text}`}
                    className={isCurrent ? undefined : TOKEN_CLASS[token.kind]}
                  >
                    {token.text}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
