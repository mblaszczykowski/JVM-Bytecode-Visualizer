import { ButtonLink } from '../ui/Button';

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
      <h1 className="min-w-0 truncate text-meta text-fg-2">
        {programName ?? appName}
        {programName === undefined ? null : (
          <span className="text-fg-3">
            {' · '}
            {appName}
          </span>
        )}
      </h1>
      <span className="grow" />
      <ButtonLink
        size="sm"
        data-testid="embed-open-full"
        href={fullUrl}
        target="_top"
        rel="noreferrer"
        className="shrink-0"
      >
        Open in full
        <span className="sr-only">(leaves this embedded view)</span>
        <span aria-hidden="true">↗</span>
      </ButtonLink>
    </header>
  );
}
