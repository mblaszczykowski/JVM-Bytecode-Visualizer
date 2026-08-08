interface EmbedBarProps {
  readonly appName: string;
  /** What is loaded, so the frame says what it is showing without the picker. */
  readonly programName: string | undefined;
  /** The same moment in the full application; opens in the top-level page. */
  readonly fullUrl: string;
}

/**
 * The toolbar of an embedded run: what this is, and the way out of it.
 *
 * Everything the full toolbar offers is navigation — pick an example, open a file, write Java —
 * and an embed is not a place to navigate. It is one run, chosen by whoever wrote the page, and
 * the only thing worth offering is the same run somewhere with more room.
 *
 * `target="_top"` rather than `_blank`: inside an iframe the default would open the full
 * application in the frame it is already too small for.
 */
export function EmbedBar({ appName, programName, fullUrl }: EmbedBarProps) {
  return (
    <header
      data-testid="embed-bar"
      className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5"
    >
      <span className="min-w-0 truncate text-meta text-fg-2">
        {programName ?? appName}
        {programName === undefined ? null : (
          <span className="text-fg-3">
            {' · '}
            {appName}
          </span>
        )}
      </span>
      <span className="grow" />
      <a
        data-testid="embed-open-full"
        href={fullUrl}
        target="_top"
        rel="noreferrer"
        className="focus-ring shrink-0 rounded-control px-2 py-0.5 text-meta text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
      >
        Open in full
        <span aria-hidden="true"> ↗</span>
      </a>
    </header>
  );
}
