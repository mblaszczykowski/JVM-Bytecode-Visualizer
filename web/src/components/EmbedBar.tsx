interface EmbedBarProps {
  readonly appName: string;
  readonly programName: string | undefined;
  readonly fullUrl: string;
}

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
