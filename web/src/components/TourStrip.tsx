import type { ResolvedStop, Tour } from '../services/tours';

interface TourStripProps {
  /** Tours the loaded example has to offer; empty for an example with none. */
  readonly available: readonly Tour[];
  /** The tour being walked, with its stops already resolved against this run. */
  readonly active?: { readonly tour: Tour; readonly stops: readonly ResolvedStop[] } | undefined;
  /** Index into `active.stops`. */
  readonly stopIndex: number;
  readonly onStart: (tourId: string) => void;
  readonly onGoToStop: (stopIndex: number) => void;
  readonly onLeave: () => void;
}

/**
 * The narration band, between the panels and the transport.
 *
 * A tour is the difference between sending someone a step and being able to argue with them
 * about it, so this is the one place in the application that is allowed to be prose. It stays
 * out of the accent entirely: blue means "the machine is here now", and a paragraph about why
 * is not that.
 *
 * Offering and walking are the same strip rather than two components, because they are the same
 * band of the screen in two states and splitting them would put the layout in the caller.
 */
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
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] pt-[10px]"
      >
        <span className="text-meta text-fg-3">Guided tour</span>
        <button
          type="button"
          data-testid="tour-start"
          onClick={() => {
            onStart(offered.id);
          }}
          className="focus-ring rounded-control px-[8px] py-[3px] text-label text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          {offered.title}
          <span aria-hidden="true"> →</span>
        </button>
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
      className="mx-[18px] mt-[10px] rounded-panel bg-raised px-[16px] py-[12px] shadow-panel"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold text-fg">{stop.title}</h2>
        <span className="shrink-0 font-mono text-micro text-fg-3 tabular-nums">
          {stopIndex + 1} / {active.stops.length}
        </span>
      </div>

      {/*
        Announced rather than merely swapped: the reader who moved to the next stop is not
        necessarily the reader looking at the panel it moved to.
      */}
      <p aria-live="polite" className="mt-[6px] text-body text-fg-2">
        {stop.body}
      </p>

      <div className="mt-[10px] flex items-center gap-2">
        <button
          type="button"
          data-testid="tour-previous"
          disabled={isFirst}
          aria-label="Previous stop"
          onClick={() => {
            onGoToStop(stopIndex - 1);
          }}
          className={CONTROL}
        >
          Back
        </button>
        <button
          type="button"
          data-testid="tour-next"
          disabled={isLast}
          aria-label="Next stop"
          onClick={() => {
            onGoToStop(stopIndex + 1);
          }}
          className={CONTROL}
        >
          Next
        </button>
        <span className="grow" />
        <button
          type="button"
          data-testid="tour-leave"
          onClick={onLeave}
          className="focus-ring rounded-control px-[8px] py-[4px] text-meta text-fg-3 transition-colors duration-150 hover:bg-raised-active hover:text-fg-2"
        >
          {isLast ? 'Done' : 'Leave the tour'}
        </button>
      </div>
    </section>
  );
}

const CONTROL =
  'focus-ring rounded-control bg-raised-active px-[10px] py-[4px] text-label text-fg-2 transition-colors duration-150 hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:text-fg-2';
