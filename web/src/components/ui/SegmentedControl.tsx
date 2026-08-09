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
  readonly tone?: 'default' | 'inverted';
  readonly prominent?: boolean;
  readonly disabled?: boolean;
  readonly title?: string | undefined;
  readonly label: string;
  readonly labelIsVisible?: boolean;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

const RAISED = 'bg-raised-active text-fg shadow-control-raised';
const INVERTED = 'bg-fg text-app hover:bg-fg-2';
const RESTING = 'text-fg-2 hover:bg-raised hover:text-fg';

export function Segment({
  selected,
  tone = 'default',
  prominent = false,
  disabled = false,
  title,
  label,
  labelIsVisible = false,
  className = 'px-3 py-1',
  onClick,
  children,
}: SegmentProps) {
  const inverted = tone === 'inverted';
  const active =
    inverted && (prominent || selected === true)
      ? INVERTED
      : selected === true || prominent
        ? RAISED
        : RESTING;

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={labelIsVisible ? undefined : label}
      aria-disabled={disabled || undefined}
      title={title ?? label}
      onClick={() => {
        if (!disabled) {
          onClick();
        }
      }}
      className={`focus-ring flex items-center justify-center rounded-[4px] text-label transition-colors duration-150 aria-disabled:cursor-default aria-disabled:text-fg-dim ${active} ${className}`}
    >
      {children}
    </button>
  );
}
