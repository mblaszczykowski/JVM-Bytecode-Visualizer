/**
 * The location hash as a pointer into a run: which bundled example, and where in it.
 *
 * `#/bubble-sort/248` is the step the reader is looking at, so a link shares a moment rather
 * than a program. `#/bubble-sort/tour/the-swap/2` shares an argument instead — a named sequence
 * of steps with something to say at each of them.
 *
 * Only bundled examples can be addressed — an uploaded `.class` never leaves the tab, so there
 * is nothing on the other end of the link to load.
 *
 * Steps and tour stops are 1-based in the URL, matching the `step 13 / 40` the transport shows;
 * both are indexed from 0 internally. The conversion happens here and nowhere else.
 */

/** Same shape the manifest enforces, so a hash can never name an id the manifest could not. */
const EXAMPLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOUR_ID = EXAMPLE_ID;
const POSITIVE = /^[1-9][0-9]*$/;

/** The segment that tells a tour id apart from a step number; steps are digits, this is not. */
const TOUR = 'tour';

export interface DeepLink {
  readonly exampleId: string;
  /** 0-based index into the snapshot history; absent when the hash named no step. */
  readonly stepIndex?: number;
  /** Present when the hash named a tour rather than a bare step. */
  readonly tour?: TourLink;
}

export interface TourLink {
  readonly tourId: string;
  /** 0-based index into the tour's stops; 0 when the hash named the tour alone. */
  readonly stopIndex: number;
}

export function parseDeepLink(hash: string): DeepLink | undefined {
  const segments = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((segment) => segment !== '');
  const [exampleId, ...tail] = segments;

  if (exampleId === undefined || !EXAMPLE_ID.test(exampleId)) {
    return undefined;
  }
  if (tail.length === 0) {
    return { exampleId };
  }

  if (tail[0] === TOUR) {
    const [, tourId, stop] = tail;
    if (tourId === undefined || !TOUR_ID.test(tourId) || tail.length > 3) {
      return undefined;
    }
    if (stop === undefined) {
      return { exampleId, tour: { tourId, stopIndex: 0 } };
    }
    if (!POSITIVE.test(stop)) {
      return undefined;
    }
    return { exampleId, tour: { tourId, stopIndex: Number(stop) - 1 } };
  }

  // Anything else is `#/example/<step>`, and only that.
  const [step] = tail;
  if (tail.length > 1 || step === undefined || !POSITIVE.test(step)) {
    return undefined;
  }
  return { exampleId, stepIndex: Number(step) - 1 };
}

export function formatDeepLink(exampleId: string, stepIndex?: number): string {
  return stepIndex === undefined ? `#/${exampleId}` : `#/${exampleId}/${String(stepIndex + 1)}`;
}

export function formatTourLink(exampleId: string, tourId: string, stopIndex: number): string {
  return `#/${exampleId}/${TOUR}/${tourId}/${String(stopIndex + 1)}`;
}

/**
 * Replaces rather than pushes: stepping through a run would otherwise bury the back button
 * under one entry per instruction, and the history is a scrubber, not a set of pages.
 */
export function writeDeepLink(exampleId: string, stepIndex?: number): void {
  replaceHash(formatDeepLink(exampleId, stepIndex));
}

export function writeTourLink(exampleId: string, tourId: string, stopIndex: number): void {
  replaceHash(formatTourLink(exampleId, tourId, stopIndex));
}

function replaceHash(next: string): void {
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}
