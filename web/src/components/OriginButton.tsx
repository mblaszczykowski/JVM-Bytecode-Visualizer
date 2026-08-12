import type { KeyboardEvent } from 'react';

interface OriginButtonProps {
  readonly step: number;
  readonly sentence: string;
  readonly testId: string;
  readonly row: number;
  readonly anchorRow: number;
  readonly onSeekToStep: (step: number) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, row: number) => void;
}

const SURFACE =
  'focus-ring shrink-0 rounded-chip px-1 text-micro text-fg-3 transition-colors duration-150 hover:bg-raised-active hover:text-fg';

export function OriginButton({
  step,
  sentence,
  testId,
  row,
  anchorRow,
  onSeekToStep,
  onKeyDown,
}: OriginButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-origin-row={row}
      tabIndex={row === anchorRow ? 0 : -1}
      aria-label={`Go to step ${String(step + 1)}, where ${sentence}`}
      onClick={() => {
        onSeekToStep(step);
      }}
      onKeyDown={(event) => {
        onKeyDown(event, row);
      }}
      className={SURFACE}
    >
      {`from ${String(step + 1)}`}
    </button>
  );
}
