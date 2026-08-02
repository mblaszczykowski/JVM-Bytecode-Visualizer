/**
 * The location hash as a pointer into a run: which bundled example, and where in its history.
 *
 * `#/bubble-sort/248` is the step the reader is looking at, so a link shares a moment rather
 * than a program. Only bundled examples can be addressed — an uploaded `.class` never leaves
 * the tab, so there is nothing on the other end of the link to load.
 *
 * The step in the URL is 1-based, matching the `step 13 / 40` the transport shows; the history
 * is indexed from 0. The conversion happens here and nowhere else.
 */

/** Same shape the manifest enforces, so a hash can never name an id the manifest could not. */
const EXAMPLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface DeepLink {
  readonly exampleId: string;
  /** 0-based index into the snapshot history; absent when the hash named only the example. */
  readonly stepIndex?: number;
}

export function parseDeepLink(hash: string): DeepLink | undefined {
  const segments = hash.replace(/^#\/?/, '').split('/');
  const [exampleId, step, ...rest] = segments;

  if (exampleId === undefined || !EXAMPLE_ID.test(exampleId) || rest.length > 0) {
    return undefined;
  }
  if (step === undefined || step === '') {
    return { exampleId };
  }

  // A step that is not a positive integer is a broken link, not a request for step 1.
  if (!/^[1-9][0-9]*$/.test(step)) {
    return undefined;
  }
  return { exampleId, stepIndex: Number(step) - 1 };
}

export function formatDeepLink(exampleId: string, stepIndex?: number): string {
  return stepIndex === undefined ? `#/${exampleId}` : `#/${exampleId}/${String(stepIndex + 1)}`;
}

/**
 * Replaces rather than pushes: stepping through a run would otherwise bury the back button
 * under one entry per instruction, and the history is a scrubber, not a set of pages.
 */
export function writeDeepLink(exampleId: string, stepIndex?: number): void {
  const next = formatDeepLink(exampleId, stepIndex);
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}
