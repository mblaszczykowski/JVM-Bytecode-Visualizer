import type { ReactNode } from 'react';

import { CurrentRowHighlight } from './CurrentRowHighlight';
import { Panel } from './Panel';
import { CODE_ROW } from './rhythm';
import { TOKEN_CLASS, tokenizeJava } from './syntax';
import { Pill } from './ui/Pill';
import { useRowNavigation } from './useRowNavigation';
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
  /** First step of the run that reached each line; a line without one cannot be sought to. */
  readonly stepForLine?: ReadonlyMap<number, number> | undefined;
  readonly onSeek?: ((step: number) => void) | undefined;
  /**
   * Line the reader is pointing at, from either code panel — marked so the instructions it
   * compiled to can be marked with it. Weaker than the accent, which means "current step".
   */
  readonly linkedLine?: number | undefined;
  /** Pointer or focus moved onto a line, or off the listing entirely (`undefined`). */
  readonly onLinkedLineChange?: ((line: number | undefined) => void) | undefined;
  /** Slide the highlight between lines; switched off above 4× playback. */
  readonly animateHighlight?: boolean;
  /** Rendered in the panel header in place of the title — the Source/Class switch. */
  readonly titleControl?: ReactNode;
  readonly className?: string;
}

export function SourcePanel({
  fileName,
  lines,
  currentLine,
  pcRange,
  lineMappingNote,
  stepForLine,
  onSeek,
  linkedLine,
  onLinkedLineChange,
  animateHighlight = false,
  titleControl,
  className = '',
}: SourcePanelProps) {
  const currentIndex = currentLine === undefined ? undefined : currentLine - 1;
  const isMapped = currentIndex !== undefined && currentIndex >= 0 && currentIndex < lines.length;
  const contentRef = useScrollFollow(isMapped ? currentIndex : undefined);
  const rows = useRowNavigation(lines.length, isMapped ? currentIndex : undefined);

  // Anything that does not fit on a code row goes to the footer rather than growing the row.
  const footer = !isMapped ? undefined : (
    <div className="flex flex-wrap items-center gap-[10px]">
      {pcRange === undefined ? null : (
        <Pill tone="accent">
          pc {pcRange.from}–{pcRange.to}
        </Pill>
      )}
      {lineMappingNote === undefined ? null : (
        <span className="font-mono text-micro text-white/55">{lineMappingNote}</span>
      )}
    </div>
  );

  return (
    <Panel
      title="Source"
      meta={fileName}
      titleControl={titleControl}
      contentRef={contentRef}
      footer={footer}
      // A long line is cut by the panel edge; the fade says so instead of letting it end
      // mid-word as if the text were complete.
      bodyClassName="fade-right"
      className={className}
    >
      {/* `isolate` keeps the highlight's negative z-index from sinking below the panel. */}
      <ol
        className="isolate px-[10px]"
        onMouseLeave={() => {
          onLinkedLineChange?.(undefined);
        }}
      >
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isCurrent = lineNumber === currentLine;
          const isLinked = !isCurrent && lineNumber === linkedLine;
          const step = stepForLine?.get(lineNumber);
          // A code row never wraps (design §12), so a long line is cut by the panel edge and
          // on a narrow screen a javadoc paragraph reaches the reader as "…is le". The row
          // cannot know how much of itself is on screen, so every line with content carries
          // its own text — the answer is then one hover away at any width.
          const full = line.trim();

          return (
            <li
              key={lineNumber}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={isCurrent ? 'current-source-line' : 'source-line'}
              data-linked={isLinked ? 'true' : undefined}
              title={full === '' ? undefined : full}
              onMouseEnter={() => {
                onLinkedLineChange?.(lineNumber);
              }}
              className={`${CODE_ROW} ${
                isCurrent
                  ? 'text-accent-text'
                  : isLinked
                    ? 'bg-white/[0.055] text-white/80'
                    : 'text-white/60'
              }`}
            >
              {isCurrent ? (
                <CurrentRowHighlight layoutId="source-highlight" animate={animateHighlight} />
              ) : null}
              <span
                className={`w-7 shrink-0 text-right select-none ${
                  isCurrent ? 'text-accent-dim' : isLinked ? 'text-white/45' : 'text-white/24'
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

              {step === undefined || onSeek === undefined ? null : (
                <button
                  type="button"
                  data-row-index={index}
                  tabIndex={index === rows.anchorIndex ? 0 : -1}
                  // The overlay covers the row, so it has to carry the row's tooltip with it.
                  title={full === '' ? undefined : full}
                  aria-label={`Go to line ${String(lineNumber)}`}
                  onClick={() => {
                    onSeek(step);
                  }}
                  onKeyDown={(event) => {
                    rows.onKeyDown(event, index);
                  }}
                  onFocus={() => {
                    onLinkedLineChange?.(lineNumber);
                  }}
                  onBlur={() => {
                    onLinkedLineChange?.(undefined);
                  }}
                  // The row is already drawn; this only has to be the target you can hit.
                  className="focus-ring absolute inset-0 rounded-code"
                />
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
