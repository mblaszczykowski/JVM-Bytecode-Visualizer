import type { ReactNode } from 'react';

interface SegmentedControlProps {
  /** Accessible name of the group (`aria-label`). */
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Recessed pill container holding a row of {@link Segment} buttons. Used both as a value
 * selector (examples) and as an action cluster (transport), so it stays a plain container
 * instead of owning a selection model.
 */
export function SegmentedControl({
  label,
  className = 'p-[3px]',
  children,
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-[3px] rounded-full bg-white/7 shadow-control-inset ${className}`}
    >
      {children}
    </div>
  );
}

interface SegmentProps {
  /**
   * Renders the raised state and reports it as `aria-pressed`. Left undefined for segments
   * that are plain actions rather than toggles, so no pressed state is announced.
   */
  readonly selected?: boolean | undefined;
  /** `inverted` is the playing state of the transport: light fill, dark glyph. */
  readonly tone?: 'default' | 'inverted';
  /**
   * Keeps the raised surface even when unselected. The play button is the one control the
   * reader is looking for, so it has to read as the primary action before it is pressed.
   */
  readonly prominent?: boolean;
  /**
   * Reported as `aria-disabled`, not as the `disabled` attribute: a disabled button drops
   * out of the tab order, and losing the tab stop at both ends of the history means a
   * keyboard walk through the transport changes shape depending on the current step.
   */
  readonly disabled?: boolean;
  readonly title?: string | undefined;
  readonly label: string;
  /** Set when the visible content already names the segment, so it is not announced twice. */
  readonly labelIsVisible?: boolean;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

const RAISED = 'bg-white/[0.18] text-white/95 shadow-control-raised';
const INVERTED = 'bg-white/[0.92] text-[#10131b] shadow-control-raised';
const RESTING = 'text-white/52 hover:text-white/85';

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
  const active =
    selected === true ? (tone === 'inverted' ? INVERTED : RAISED) : prominent ? RAISED : RESTING;

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
      className={`focus-ring flex items-center justify-center rounded-full text-label transition-colors aria-disabled:cursor-default aria-disabled:opacity-30 ${active} ${className}`}
    >
      {children}
    </button>
  );
}
