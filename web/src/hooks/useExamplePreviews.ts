import { useEffect, useState } from 'react';

import { parseClassFile } from '../core/classfile';
import { fetchExampleClass } from '../services/loading/examples';
import type { ExampleEntry } from '../services/loading/manifest';
import { previewProgram, type RunPreview } from '../services/loading/program';
import type { ProgramRunner } from '../services/loading/program-runner';

const NONE: ReadonlyMap<string, RunPreview> = new Map();

export function useExamplePreviews(
  entries: readonly ExampleEntry[],
  runner: ProgramRunner,
): ReadonlyMap<string, RunPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, RunPreview>>(NONE);
  const [tracked, setTracked] = useState({ entries, runner });

  if (entries !== tracked.entries || runner !== tracked.runner) {
    setTracked({ entries, runner });
    setPreviews(NONE);
  }

  useEffect(() => {
    if (entries.length === 0) {
      return;
    }
    const abandon = new AbortController();
    const { signal } = abandon;

    const measure = async (entry: ExampleEntry): Promise<RunPreview | undefined> => {
      try {
        return await previewProgram(parseClassFile(await fetchExampleClass(entry, signal)), {
          runner,
          signal,
        });
      } catch {
        return undefined;
      }
    };

    const measureInTurn = async (): Promise<void> => {
      const measured = new Map<string, RunPreview>();
      for (const entry of entries) {
        const preview = await measure(entry);
        if (signal.aborted) {
          return;
        }
        if (preview !== undefined) {
          measured.set(entry.id, preview);
          setPreviews(new Map(measured));
        }
      }
    };

    void measureInTurn();

    return () => {
      abandon.abort();
    };
  }, [entries, runner]);

  return previews;
}
