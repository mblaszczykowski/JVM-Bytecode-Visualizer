export type BannerSeverity = 'error' | 'warning' | 'info';

interface ErrorBannerProps {
  readonly message: string;
  readonly severity: BannerSeverity;
}

/**
 * Warianty odpowiadają stanom z plan §9 Faza 7: `ClassFileError`/`VmError` to `error`,
 * `step-limit` to `warning` (program nie jest zepsuty — po prostu się nie kończy).
 */
const SEVERITY_STYLE: Record<BannerSeverity, string> = {
  error: 'bg-[rgb(255_69_58/0.18)] text-[#ffe5e3] shadow-[inset_0_0_0_1px_rgb(255_69_58/0.40)]',
  warning: 'bg-[rgb(255_214_10/0.16)] text-[#fff3c4] shadow-[inset_0_0_0_1px_rgb(255_214_10/0.38)]',
  info: 'bg-white/[0.06] text-white/70 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]',
};

const SEVERITY_LABEL: Record<BannerSeverity, string> = {
  error: 'Błąd',
  warning: 'Ostrzeżenie',
  info: 'Informacja',
};

export function ErrorBanner({ message, severity }: ErrorBannerProps) {
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      data-testid="error-banner"
      data-severity={severity}
      className={`flex items-baseline gap-3 rounded-[12px] px-[14px] py-[9px] text-[12px] ${SEVERITY_STYLE[severity]}`}
    >
      <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-80">
        {SEVERITY_LABEL[severity]}
      </span>
      <span>{message}</span>
    </div>
  );
}
