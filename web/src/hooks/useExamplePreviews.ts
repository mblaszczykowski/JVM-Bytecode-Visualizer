import { useEffect, useState } from 'react';

import { parseClassFile } from '../core/classfile';
import { fetchExampleClass } from '../services/examples';
import type { ExampleEntry } from '../services/manifest';
import { previewProgram, type RunPreview } from '../services/program';

const NONE: ReadonlyMap<string, RunPreview> = new Map();

/**
 * Runs each bundled example far enough to know how long it is and how deep it goes, so the
 * welcome cards can say "40 steps, five frames deep" instead of leaving that to be discovered
 * by clicking. The programs are a few hundred instructions each, so this costs a few
 * milliseconds and one request per example — for files the reader is about to ask for anyway.
 *
 * A preview that fails is simply absent: a card without a sparkline still opens its example.
 */
export function useExamplePreviews(
  entries: readonly ExampleEntry[],
): ReadonlyMap<string, RunPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, RunPreview>>(NONE);

  useEffect(() => {
    if (entries.length === 0) {
      return;
    }
    let active = true;

    void Promise.all(
      entries.map(async (entry): Promise<readonly [string, RunPreview] | undefined> => {
        try {
          return [entry.id, previewProgram(parseClassFile(await fetchExampleClass(entry)))];
        } catch {
          return undefined;
        }
      }),
    ).then((results) => {
      if (active) {
        setPreviews(new Map(results.filter((result) => result !== undefined)));
      }
    });

    return () => {
      active = false;
    };
  }, [entries]);

  return previews;
}
