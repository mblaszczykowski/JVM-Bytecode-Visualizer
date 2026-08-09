const EXAMPLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOUR_ID = EXAMPLE_ID;
const POSITIVE = /^[1-9][0-9]*$/;

const TOUR = 'tour';

export interface DeepLink {
  readonly exampleId: string;
  readonly stepIndex?: number;
  readonly tour?: TourLink;
}

export interface TourLink {
  readonly tourId: string;
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
