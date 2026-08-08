import { describe, expect, it } from 'vitest';

import { fullAppUrl, isEmbedded } from './embed';

describe('isEmbedded', () => {
  it.each(['?embed', '?embed=1', '?embed=', '?theme=dark&embed'])('recognises %o', (search) => {
    expect(isEmbedded(search)).toBe(true);
  });

  it.each(['', '?', '?theme=dark', '?embedded=1'])('does not recognise %o', (search) => {
    expect(isEmbedded(search)).toBe(false);
  });
});

describe('fullAppUrl', () => {
  it('drops the flag and keeps the moment', () => {
    expect(fullAppUrl('https://host/?embed#/bubble-sort/248')).toBe(
      'https://host/#/bubble-sort/248',
    );
  });

  it('keeps a tour stop, which is what an embed is most likely showing', () => {
    expect(fullAppUrl('https://host/?embed=1#/factorial/tour/recursion/3')).toBe(
      'https://host/#/factorial/tour/recursion/3',
    );
  });

  it('leaves the other parameters alone', () => {
    expect(fullAppUrl('https://host/?theme=dark&embed#/factorial')).toBe(
      'https://host/?theme=dark#/factorial',
    );
  });

  it('leaves a URL that was never an embed unchanged', () => {
    expect(fullAppUrl('https://host/#/factorial/13')).toBe('https://host/#/factorial/13');
  });
});
