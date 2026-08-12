import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatDeepLink,
  formatTourLink,
  parseDeepLink,
  writeDeepLink,
  writeTourLink,
} from './deep-link';

describe('parseDeepLink', () => {
  it('reads an example on its own', () => {
    expect(parseDeepLink('#/factorial')).toEqual({ exampleId: 'factorial' });
  });

  it('reads a kebab-case id', () => {
    expect(parseDeepLink('#/sum-of-products')).toEqual({ exampleId: 'sum-of-products' });
  });

  it('converts the 1-based step in the URL to a history index', () => {
    expect(parseDeepLink('#/bubble-sort/248')).toEqual({
      exampleId: 'bubble-sort',
      stepIndex: 247,
    });
  });

  it('reads the first step', () => {
    expect(parseDeepLink('#/factorial/1')).toEqual({ exampleId: 'factorial', stepIndex: 0 });
  });

  it('tolerates a hash without the leading slash', () => {
    expect(parseDeepLink('#factorial/2')).toEqual({ exampleId: 'factorial', stepIndex: 1 });
  });

  it.each(['', '#', '#/'])('has nothing to say about %o', (hash) => {
    expect(parseDeepLink(hash)).toBeUndefined();
  });

  it.each(['#/Factorial', '#/bubble_sort', '#/-factorial', '#/factorial-'])(
    'rejects %o, which the manifest could not have produced',
    (hash) => {
      expect(parseDeepLink(hash)).toBeUndefined();
    },
  );

  it.each(['#/factorial/0', '#/factorial/-1', '#/factorial/2.5', '#/factorial/last'])(
    'rejects %o rather than falling back to the first step',
    (hash) => {
      expect(parseDeepLink(hash)).toBeUndefined();
    },
  );

  it('rejects a third segment instead of ignoring it', () => {
    expect(parseDeepLink('#/factorial/2/extra')).toBeUndefined();
  });
});

describe('formatDeepLink', () => {
  it('writes the example alone when there is no step', () => {
    expect(formatDeepLink('factorial')).toBe('#/factorial');
  });

  it('writes the step 1-based', () => {
    expect(formatDeepLink('bubble-sort', 247)).toBe('#/bubble-sort/248');
  });

  it('round-trips through the parser', () => {
    const link = formatDeepLink('collatz', 120);
    expect(parseDeepLink(link)).toEqual({ exampleId: 'collatz', stepIndex: 120 });
  });
});

describe('tour links', () => {
  it('reads a tour named on its own as its first stop', () => {
    expect(parseDeepLink('#/factorial/tour/recursion')).toEqual({
      exampleId: 'factorial',
      tour: { tourId: 'recursion', stopIndex: 0 },
    });
  });

  it('converts the 1-based stop in the URL to an index', () => {
    expect(parseDeepLink('#/bubble-sort/tour/the-swap/3')).toEqual({
      exampleId: 'bubble-sort',
      tour: { tourId: 'the-swap', stopIndex: 2 },
    });
  });

  it('keeps a bare step and a tour apart', () => {
    expect(parseDeepLink('#/factorial/13')).toEqual({ exampleId: 'factorial', stepIndex: 12 });
    expect(parseDeepLink('#/factorial/tour/recursion')?.stepIndex).toBeUndefined();
  });

  it.each(['#/factorial/tour', '#/factorial/tour/Recursion', '#/factorial/tour/recursion/0'])(
    'rejects %o',
    (hash) => {
      expect(parseDeepLink(hash)).toBeUndefined();
    },
  );

  it('rejects a fourth segment after the stop', () => {
    expect(parseDeepLink('#/factorial/tour/recursion/2/extra')).toBeUndefined();
  });

  it('round-trips through the formatter', () => {
    const link = formatTourLink('collatz', 'the-loop', 4);
    expect(link).toBe('#/collatz/tour/the-loop/5');
    expect(parseDeepLink(link)).toEqual({
      exampleId: 'collatz',
      tour: { tourId: 'the-loop', stopIndex: 4 },
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseDeepLink('#/factorial/')).toEqual({ exampleId: 'factorial' });
  });
});

describe('writing the address bar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', window.location.pathname);
  });

  function watchHistory() {
    return vi.spyOn(window.history, 'replaceState');
  }

  it('puts the step the reader is on in the address bar', () => {
    const replaceState = watchHistory();

    writeDeepLink('bubble-sort', 247);

    expect(window.location.hash).toBe('#/bubble-sort/248');
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it('writes the example alone before anything has been executed', () => {
    writeDeepLink('factorial');

    expect(window.location.hash).toBe('#/factorial');
  });

  it('leaves no new entry in the browser history behind either link', () => {
    const pushState = vi.spyOn(window.history, 'pushState');

    writeDeepLink('factorial', 3);
    writeTourLink('factorial', 'recursion', 2);

    expect(pushState).not.toHaveBeenCalled();
  });

  it('says nothing when the address bar already reads that way', () => {
    writeDeepLink('factorial', 3);
    const replaceState = watchHistory();

    writeDeepLink('factorial', 3);

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/factorial/4');
  });

  it('writes a tour stop, and stops writing when it does not move', () => {
    writeTourLink('collatz', 'the-loop', 4);
    const replaceState = watchHistory();

    writeTourLink('collatz', 'the-loop', 4);
    writeTourLink('collatz', 'the-loop', 5);

    expect(window.location.hash).toBe('#/collatz/tour/the-loop/6');
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it('is read back by the parser as the place it was written from', () => {
    writeTourLink('collatz', 'the-loop', 4);

    expect(parseDeepLink(window.location.hash)).toEqual({
      exampleId: 'collatz',
      tour: { tourId: 'the-loop', stopIndex: 4 },
    });
  });
});
