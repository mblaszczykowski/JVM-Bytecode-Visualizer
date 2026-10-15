import { useEffect, useMemo, useRef, useState } from 'react';

import type { Snapshot } from '../core/interpreter';
import type { DeepLink } from '../services/session/deep-link';
import {
  resolveTour,
  tourFor,
  toursFor,
  type ResolvedStop,
  type Tour,
} from '../services/views/tours';

const NO_TOURS: readonly Tour[] = [];

export interface ActiveTour {
  readonly tour: Tour;
  readonly stops: readonly ResolvedStop[];
}

export interface GuidedTourInput {
  readonly exampleId: string | undefined;
  readonly snapshots: readonly Snapshot[];
  readonly seekTo: (step: number) => void;
  readonly openedAt: DeepLink | undefined;
}

export interface GuidedTour {
  readonly available: readonly Tour[];
  readonly active: ActiveTour | undefined;
  readonly stopIndex: number;
  readonly start: (tourId: string) => void;
  readonly goToStop: (stopIndex: number) => void;
  readonly leave: () => void;
}

export function useGuidedTour({
  exampleId,
  snapshots,
  seekTo,
  openedAt,
}: GuidedTourInput): GuidedTour {
  const [tourId, setTourId] = useState<string | undefined>(undefined);
  const [stopIndex, setStopIndex] = useState(0);
  const [trackedExample, setTrackedExample] = useState(exampleId);
  const pendingTour = useRef(openedAt?.tour);
  const stepCount = snapshots.length;

  if (exampleId !== undefined && exampleId !== trackedExample) {
    setTrackedExample(exampleId);
    setTourId(undefined);
    setStopIndex(0);
  }

  const available = exampleId === undefined ? NO_TOURS : toursFor(exampleId);

  const active = useMemo(() => {
    if (exampleId === undefined || tourId === undefined) {
      return undefined;
    }
    const tour = tourFor(exampleId, tourId);
    if (tour === undefined) {
      return undefined;
    }
    const stops = resolveTour(tour, snapshots);
    return stops.length === 0 ? undefined : { tour, stops };
  }, [exampleId, tourId, snapshots]);

  useEffect(() => {
    const link = pendingTour.current;
    if (
      link === undefined ||
      stepCount === 0 ||
      exampleId === undefined ||
      exampleId !== openedAt?.exampleId
    ) {
      return;
    }
    pendingTour.current = undefined;
    const tour = tourFor(exampleId, link.tourId);
    if (tour === undefined || resolveTour(tour, snapshots)[link.stopIndex] === undefined) {
      return;
    }
    setTourId(link.tourId);
    setStopIndex(link.stopIndex);
  }, [exampleId, openedAt, stepCount, snapshots]);

  useEffect(() => {
    const stop = active?.stops[stopIndex];
    if (stop !== undefined) {
      seekTo(stop.step);
    }
  }, [active, stopIndex, seekTo]);

  const goToStop = (index: number) => {
    const stop = active?.stops[index];
    if (stop === undefined) {
      return;
    }
    setStopIndex(index);
    seekTo(stop.step);
  };

  const start = (id: string) => {
    setTourId(id);
    setStopIndex(0);
  };

  const leave = () => {
    setTourId(undefined);
    setStopIndex(0);
  };

  return { available, active, stopIndex, start, goToStop, leave };
}
