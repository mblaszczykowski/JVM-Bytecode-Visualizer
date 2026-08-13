import { Button } from '../ui/Button';

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
  error: 'bg-error-wash text-error shadow-banner-error',
  warning: 'bg-warn-wash text-warn shadow-banner-warn',
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
        <Button tone="nested" onClick={action.onAction} className="shrink-0">
          {action.label}
        </Button>
      )}
      {onDismiss === undefined ? null : (
        <Button
          size="sm"
          aria-label="Dismiss this message"
          onClick={onDismiss}
          className="-my-1 shrink-0 self-center text-body leading-none text-fg-3"
        >
          <span aria-hidden="true">×</span>
        </Button>
      )}
    </div>
  );
}
