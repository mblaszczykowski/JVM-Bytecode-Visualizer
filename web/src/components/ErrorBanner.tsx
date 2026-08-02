export type BannerSeverity = 'error' | 'warning' | 'info';

interface BannerAction {
  readonly label: string;
  readonly onAction: () => void;
}

interface ErrorBannerProps {
  readonly message: string;
  readonly severity: BannerSeverity;
  /** Optional recovery affordance, e.g. raising the step limit. */
  readonly action?: BannerAction | undefined;
  /** When given, the banner can be closed — nothing here blocks the rest of the screen. */
  readonly onDismiss?: (() => void) | undefined;
}

/**
 * Banners borrow the grammar of the current-step highlight — a fill plus an inset outline —
 * so the screen keeps one visual language for "look here".
 *
 * A stopped run (§8: `ClassFileError`, `VmError`) is an `error`; one that merely ran out of
 * steps is a `warning`, because nothing about the program is broken — and it is the variant
 * that arrives with a "raise the limit" action.
 *
 * The fill is deliberately weak. A saturated bar reads as a strip pasted over the glass; the
 * severity is carried by the coloured hairline and the tinted text, which is the same way
 * every other surface here separates itself from the one below it.
 */
const SEVERITY_STYLE: Record<BannerSeverity, string> = {
  error: 'bg-error/[0.13] text-[#ffe0dd] shadow-[inset_0_0_0_1px_rgb(255_69_58/0.42)]',
  warning: 'bg-warn/[0.10] text-[#fff1ba] shadow-[inset_0_0_0_1px_rgb(255_214_10/0.40)]',
  info: 'bg-white/[0.05] text-white/70 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]',
};

const SEVERITY_LABEL: Record<BannerSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

/** Panel radius and panel gutter, so the banner lines its text up with whatever it sits under. */
const FRAME = 'flex items-baseline gap-3 rounded-panel px-[16px] py-[12px] text-body';

export function ErrorBanner({ message, severity, action, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      data-testid="error-banner"
      data-severity={severity}
      className={`${FRAME} ${SEVERITY_STYLE[severity]}`}
    >
      {/* Plain sentence case: small caps and letterspacing here would read as a dashboard. */}
      <span className="shrink-0 text-label font-semibold opacity-80">
        {SEVERITY_LABEL[severity]}
      </span>
      <span className="grow">{message}</span>
      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onAction}
          className="focus-ring shrink-0 rounded-full bg-white/12 px-[11px] py-[4px] text-meta transition-colors hover:bg-white/22"
        >
          {action.label}
        </button>
      )}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          aria-label="Dismiss this message"
          onClick={onDismiss}
          className="focus-ring -my-1 shrink-0 self-center rounded-full px-[7px] py-[3px] text-body leading-none opacity-70 transition-opacity hover:bg-white/10 hover:opacity-100"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
