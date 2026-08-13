import type { ReactNode } from 'react';

import { useRowNavigation } from '../../hooks/useRowNavigation';
import { rowTopOf, useScrollFollow } from '../../hooks/useScrollFollow';
import { tokenizeJavaLines, type TokenKind } from '../../services/syntax';

import { CurrentRowHighlight } from './CurrentRowHighlight';
import { Panel } from './Panel';
import { CODE_ROW, NUMBER_COLUMN } from '../rhythm';
import { Pill } from '../ui/Pill';

const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-syntax-keyword',
  method: 'text-syntax-method',
  type: 'text-syntax-type',
  number: 'text-syntax-number',
  comment: 'text-fg-3',
  text: '',
};

interface SourcePanelProps {
  readonly fileName: string;
  readonly lines: readonly string[];
  readonly currentLine: number | undefined;
  readonly pcRange?: { readonly from: number; readonly to: number } | undefined;
  readonly lineMappingNote?: string | undefined;
  readonly stepForLine?: ReadonlyMap<number, number> | undefined;
  readonly onSeek?: ((step: number) => void) | undefined;
  readonly linkedLine?: number | undefined;
  readonly onLinkedLineChange?: ((line: number | undefined) => void) | undefined;
  readonly animateHighlight?: boolean;
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
  const contentRef = useScrollFollow(rowTopOf(isMapped ? currentIndex : undefined));
  const rows = useRowNavigation(lines.length, isMapped ? currentIndex : undefined);
  const highlighted = tokenizeJavaLines(lines);

  const footer = !isMapped ? undefined : (
    <div className="flex flex-wrap items-center gap-2.5">
      {pcRange === undefined ? null : (
        <Pill tone="accent">
          pc {pcRange.from}–{pcRange.to}
        </Pill>
      )}
      {lineMappingNote === undefined ? null : (
        <span className="font-mono text-micro text-fg-3">{lineMappingNote}</span>
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
      bodyClassName="fade-right"
      className={className}
    >
      <ol
        className="isolate px-2.5"
        onMouseLeave={() => {
          onLinkedLineChange?.(undefined);
        }}
      >
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isCurrent = lineNumber === currentLine;
          const isLinked = !isCurrent && lineNumber === linkedLine;
          const step = stepForLine?.get(lineNumber);
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
                isCurrent ? 'text-accent-text' : isLinked ? 'bg-raised text-fg' : 'text-fg-2'
              }`}
            >
              {isCurrent ? (
                <CurrentRowHighlight layoutId="source-highlight" animate={animateHighlight} />
              ) : null}
              <span className={`${NUMBER_COLUMN} ${isCurrent ? 'text-accent-dim' : 'text-fg-3'}`}>
                {lineNumber}
              </span>
              <span className="grow whitespace-pre [tab-size:4]">
                {(highlighted[index] ?? []).map((token, tokenIndex) => (
                  <span
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
