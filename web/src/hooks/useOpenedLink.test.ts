import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExampleEntry } from '../services/loading/manifest';

import { useOpenedLink } from './useOpenedLink';

function entry(id: string, title: string): ExampleEntry {
  return {
    id,
    title,
    tagline: `${title}, in one line.`,
    description: `${title}, at length.`,
    classFile: 'Factorial.class',
    sourceFile: 'Factorial.java',
    entryMethod: 'main',
    resultVariable: 'result',
    expectedResult: 24,
  };
}

const EXAMPLES: readonly ExampleEntry[] = [entry('factorial', 'Factorial'), entry('gcd', 'GCD')];

const NO_EXAMPLES: readonly ExampleEntry[] = [];

interface LinkProps {
  readonly examples: readonly ExampleEntry[];
  readonly embedded?: boolean;
  readonly loadedExampleId: string | undefined;
  readonly stepCount: number;
}

const NOTHING_LOADED: LinkProps = {
  examples: EXAMPLES,
  loadedExampleId: undefined,
  stepCount: 0,
};

function renderLink(hash: string, initialProps: LinkProps) {
  window.history.replaceState(null, '', hash);
  const selectExample = vi.fn<(id: string) => void>();
  const seekTo = vi.fn<(index: number) => void>();
  const view = renderHook(
    (props: LinkProps) => useOpenedLink({ embedded: false, ...props, selectExample, seekTo }),
    { initialProps },
  );
  return { ...view, selectExample, seekTo };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useOpenedLink', () => {
  it('reports the link the page was opened on', () => {
    const { result } = renderLink('#/factorial/13', NOTHING_LOADED);

    expect(result.current).toEqual({ exampleId: 'factorial', stepIndex: 12 });
  });

  it('loads the example the hash names as soon as the manifest arrives', () => {
    const { rerender, selectExample } = renderLink('#/factorial', {
      ...NOTHING_LOADED,
      examples: NO_EXAMPLES,
    });

    expect(selectExample).not.toHaveBeenCalled();

    rerender(NOTHING_LOADED);

    expect(selectExample).toHaveBeenCalledExactlyOnceWith('factorial');
  });

  it('loads the first example when it is embedded with no link to follow', () => {
    const { selectExample } = renderLink('/', { ...NOTHING_LOADED, embedded: true });

    expect(selectExample).toHaveBeenCalledExactlyOnceWith('factorial');
  });

  it('seeks to the step the link names once the run has loaded', () => {
    const { rerender, seekTo } = renderLink('#/factorial/13', NOTHING_LOADED);

    expect(seekTo).not.toHaveBeenCalled();

    rerender({ ...NOTHING_LOADED, loadedExampleId: 'factorial', stepCount: 40 });

    expect(seekTo).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('leaves the link alone until the example it names is the one that loaded', () => {
    const { rerender, seekTo } = renderLink('#/factorial/13', NOTHING_LOADED);

    rerender({ ...NOTHING_LOADED, loadedExampleId: 'gcd', stepCount: 43 });

    expect(seekTo).not.toHaveBeenCalled();

    rerender({ ...NOTHING_LOADED, loadedExampleId: 'factorial', stepCount: 40 });

    expect(seekTo).toHaveBeenCalledExactlyOnceWith(12);
  });

  it('drops a step the run never reaches rather than clamping to the end', () => {
    const { rerender, seekTo } = renderLink('#/factorial/99', NOTHING_LOADED);

    rerender({ ...NOTHING_LOADED, loadedExampleId: 'factorial', stepCount: 40 });

    expect(seekTo).not.toHaveBeenCalled();
  });

  it('restores the step once, leaving a reader who scrubs away where they are', () => {
    const loaded: LinkProps = {
      ...NOTHING_LOADED,
      loadedExampleId: 'factorial',
      stepCount: 40,
    };
    const { rerender, seekTo } = renderLink('#/factorial/13', NOTHING_LOADED);

    rerender(loaded);
    seekTo.mockClear();

    rerender({ ...loaded, stepCount: 41 });

    expect(seekTo).not.toHaveBeenCalled();
  });
});
