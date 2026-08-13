import { useEffect, useRef, useState } from 'react';

import { parseDeepLink, type DeepLink } from '../services/session/deep-link';
import type { ExampleEntry } from '../services/loading/manifest';

interface OpenedLinkOptions {
  readonly examples: readonly ExampleEntry[];
  readonly embedded: boolean;
  readonly selectExample: (id: string) => void;
  readonly loadedExampleId: string | undefined;
  readonly stepCount: number;
  readonly seekTo: (index: number) => void;
}

export function useOpenedLink({
  examples,
  embedded,
  selectExample,
  loadedExampleId,
  stepCount,
  seekTo,
}: OpenedLinkOptions): DeepLink | undefined {
  const [openedAt] = useState(() => parseDeepLink(window.location.hash));
  const pendingExample = useRef(openedAt?.exampleId);
  const pendingStep = useRef(openedAt?.stepIndex);

  const latestSelectExample = useRef(selectExample);
  useEffect(() => {
    latestSelectExample.current = selectExample;
  });

  useEffect(() => {
    const id = pendingExample.current ?? (embedded ? examples[0]?.id : undefined);
    if (id === undefined || examples.length === 0) {
      return;
    }
    pendingExample.current = undefined;
    latestSelectExample.current(id);
  }, [examples, embedded]);

  useEffect(() => {
    const step = pendingStep.current;
    if (step === undefined || stepCount === 0) {
      return;
    }
    pendingStep.current = undefined;
    if (loadedExampleId === openedAt?.exampleId && step < stepCount) {
      seekTo(step);
    }
  }, [loadedExampleId, openedAt, stepCount, seekTo]);

  return openedAt;
}
