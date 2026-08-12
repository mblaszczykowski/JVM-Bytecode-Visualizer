import type { ReactNode } from 'react';

interface SegmentedControlProps {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function SegmentedControl({ label, className = 'p-0.5', children }: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-control bg-sunken shadow-control-inset ${className}`}
    >
      {children}
    </div>
  );
}

interface SegmentProps {
  readonly selected?: boolean | undefined;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly title?: string | undefined;
  readonly label?: string | undefined;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

const PRIMARY = 'bg-fg text-app hover:bg-fg-2';
const SELECTED = 'bg-raised-active text-fg shadow-control-raised';
const RESTING = 'text-fg-2 hover:bg-raised hover:text-fg';

export function Segment({
  selected,
  primary = false,
  disabled = false,
  title,
  label,
  className = 'px-3 py-1',
  onClick,
  children,
}: SegmentProps) {
  const surface = primary ? PRIMARY : selected === true ? SELECTED : RESTING;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={title ?? label}
      onClick={() => {
        if (!disabled) {
          onClick();
        }
      }}
      className={`focus-ring flex items-center justify-center rounded-chip text-label transition-colors duration-150 aria-disabled:cursor-default aria-disabled:text-fg-dim ${surface} ${className}`}
    >
      {children}
    </button>
  );
}
