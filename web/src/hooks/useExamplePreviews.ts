import { useEffect, useState } from 'react';

import { parseClassFile } from '../core/classfile';
import { fetchExampleClass } from '../services/loading/examples';
import type { ExampleEntry } from '../services/loading/manifest';
import { previewProgram, type RunPreview } from '../services/loading/program';

const NONE: ReadonlyMap<string, RunPreview> = new Map();

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
