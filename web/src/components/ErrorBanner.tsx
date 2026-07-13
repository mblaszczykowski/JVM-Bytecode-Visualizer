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

export function ErrorBanner({ message, severity, action }: ErrorBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      data-testid="error-banner"
      data-severity={severity}
      className={`flex items-baseline gap-3 rounded-row px-[14px] py-[9px] text-[12px] ${SEVERITY_STYLE[severity]}`}
    >
      <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80">
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
    </div>
  );
}
