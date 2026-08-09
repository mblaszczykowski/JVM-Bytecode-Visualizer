export type BannerSeverity = 'error' | 'warning' | 'info';

interface BannerAction {
  readonly label: string;
  readonly onAction: () => void;
}

interface ErrorBannerProps {
  readonly message: string;
  readonly severity: BannerSeverity;
  readonly action?: BannerAction | undefined;
  readonly onDismiss?: (() => void) | undefined;
}

const SEVERITY_STYLE: Record<BannerSeverity, string> = {
  error: 'bg-error/12 text-error shadow-banner-error',
  warning: 'bg-warn/12 text-warn shadow-banner-warn',
  info: 'bg-raised text-fg-2 shadow-row-outline',
};

const SEVERITY_LABEL: Record<BannerSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

const FRAME = 'flex items-baseline gap-3 rounded-panel px-4 py-3 text-body';

export function ErrorBanner({ message, severity, action, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      data-testid="error-banner"
      data-severity={severity}
      className={`${FRAME} ${SEVERITY_STYLE[severity]}`}
    >
      <span className="shrink-0 text-label font-medium">{SEVERITY_LABEL[severity]}</span>
      <span className="grow">{message}</span>
      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onAction}
          className="focus-ring shrink-0 rounded-control bg-raised-active px-2.5 py-1 text-meta transition-colors duration-150 hover:bg-raised-active"
        >
          {action.label}
        </button>
      )}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          aria-label="Dismiss this message"
          onClick={onDismiss}
          className="focus-ring -my-1 shrink-0 self-center rounded-control px-1.5 py-0.5 text-body leading-none text-fg-3 transition-colors duration-150 hover:bg-raised-active hover:text-fg"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
