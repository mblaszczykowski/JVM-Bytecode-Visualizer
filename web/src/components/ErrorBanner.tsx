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
 * A stopped run is an `error`; one that merely ran out of steps is a `warning`, because
 * nothing about the program is broken.
 */
const SEVERITY_STYLE: Record<BannerSeverity, string> = {
  error: 'bg-error/[0.18] text-[#ffe5e3] shadow-[inset_0_0_0_1px_rgb(255_69_58/0.40)]',
  warning: 'bg-warn/[0.16] text-[#fff3c4] shadow-[inset_0_0_0_1px_rgb(255_214_10/0.38)]',
  info: 'bg-white/[0.06] text-white/70 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]',
};

const SEVERITY_LABEL: Record<BannerSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

export function ErrorBanner({ message, severity, action, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      data-testid="error-banner"
      data-severity={severity}
      className={`flex items-baseline gap-3 rounded-row px-[14px] py-[9px] text-[12px] ${SEVERITY_STYLE[severity]}`}
    >
      {/* Plain sentence case: small caps and letterspacing here would read as a dashboard. */}
      <span className="shrink-0 text-[11.5px] font-semibold opacity-85">
        {SEVERITY_LABEL[severity]}
      </span>
      <span className="grow">{message}</span>
      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onAction}
          className="focus-ring shrink-0 rounded-full bg-white/10 px-[10px] py-[3px] text-[11px] hover:bg-white/20"
        >
          {action.label}
        </button>
      )}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          aria-label="Dismiss this message"
          onClick={onDismiss}
          className="focus-ring -my-1 shrink-0 self-center rounded-full px-[7px] py-[3px] text-[13px] leading-none opacity-70 hover:bg-white/10 hover:opacity-100"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
