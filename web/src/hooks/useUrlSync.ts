import { useEffect } from 'react';

import { writeDeepLink, writeTourLink } from '../services/deep-link';

interface UrlSyncOptions {
  readonly exampleId: string | undefined;
  readonly isPlaying: boolean;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly tour: { readonly id: string; readonly stopIndex: number } | undefined;
}

export function useUrlSync({
  exampleId,
  isPlaying,
  stepIndex,
  stepCount,
  tour,
}: UrlSyncOptions): void {
  useEffect(() => {
    if (exampleId === undefined || isPlaying) {
      return;
    }
    if (tour !== undefined) {
      writeTourLink(exampleId, tour.id, tour.stopIndex);
      return;
    }
    writeDeepLink(exampleId, stepCount === 0 ? undefined : stepIndex);
  }, [exampleId, isPlaying, stepIndex, stepCount, tour]);
}
