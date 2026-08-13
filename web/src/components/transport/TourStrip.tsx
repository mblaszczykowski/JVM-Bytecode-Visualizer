import type { ResolvedStop, Tour } from '../../services/tours';

import { Button } from '../ui/Button';

interface TourStripProps {
  readonly available: readonly Tour[];
  readonly active?: { readonly tour: Tour; readonly stops: readonly ResolvedStop[] } | undefined;
  readonly stopIndex: number;
  readonly onStart: (tourId: string) => void;
  readonly onGoToStop: (stopIndex: number) => void;
  readonly onLeave: () => void;
}

export function TourStrip({
  available,
  active,
  stopIndex,
  onStart,
  onGoToStop,
  onLeave,
}: TourStripProps) {
  if (active === undefined) {
    const [offered] = available;
    if (offered === undefined) {
      return null;
    }

    return (
      <div
        data-testid="tour-offer"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2.5"
      >
        <span className="text-meta text-fg-3">Guided tour</span>
        <Button
          size="sm"
          data-testid="tour-start"
          onClick={() => {
            onStart(offered.id);
          }}
        >
          {offered.title}
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    );
  }

  const stop = active.stops[stopIndex];
  if (stop === undefined) {
    return null;
  }
  const isFirst = stopIndex === 0;
  const isLast = stopIndex === active.stops.length - 1;

  return (
    <section
      data-testid="tour-strip"
      aria-label={`Guided tour: ${active.tour.title}`}
      className="mx-4 mt-2.5 rounded-panel bg-raised px-4 py-3 shadow-panel"
    >
      <div aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-title font-medium text-fg">{stop.title}</h2>
          <span className="shrink-0 font-mono text-micro text-fg-3 tabular-nums">
            {stopIndex + 1} / {active.stops.length}
          </span>
        </div>

        <p className="mt-1.5 text-body text-fg-2">{stop.body}</p>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          tone="nested"
          data-testid="tour-previous"
          disabled={isFirst}
          aria-label="Back to the previous stop"
          onClick={() => {
            onGoToStop(stopIndex - 1);
          }}
        >
          Back
        </Button>
        <Button
          tone="nested"
          data-testid="tour-next"
          disabled={isLast}
          aria-label="Next stop"
          onClick={() => {
            onGoToStop(stopIndex + 1);
          }}
        >
          Next
        </Button>
        <span className="grow" />
        <Button size="sm" data-testid="tour-leave" onClick={onLeave}>
          {isLast ? 'Done' : 'Leave the tour'}
        </Button>
      </div>
    </section>
  );
}
