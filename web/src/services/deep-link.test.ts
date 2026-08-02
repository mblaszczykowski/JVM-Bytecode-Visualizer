import { describe, expect, it } from 'vitest';

import { formatDeepLink, parseDeepLink } from './deep-link';

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
