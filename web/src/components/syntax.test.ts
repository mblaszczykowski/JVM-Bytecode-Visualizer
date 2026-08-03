import { describe, expect, it } from 'vitest';

import { sourceLines } from './__fixtures__/factorial-run';
import { type Token, type TokenKind, tokenizeJava, tokenizeJavaLines } from './syntax';

function kindOf(tokens: readonly Token[], text: string): TokenKind | undefined {
  return tokens.find((token) => token.text === text)?.kind;
}

describe('tokenizeJava', () => {
  it('keeps the line intact when the tokens are concatenated', () => {
    // Every line of the shipped Factorial.java, javadoc and code alike.
    for (const line of sourceLines()) {
      const rebuilt = tokenizeJava(line)
        .map((token) => token.text)
        .join('');

      expect(rebuilt).toBe(line);
    }
  });

  it('marks keywords, including primitive types', () => {
    const tokens = tokenizeJava('    static int factorial(int n) {');

    expect(kindOf(tokens, 'static')).toBe('keyword');
    expect(kindOf(tokens, 'int')).toBe('keyword');
  });

  it('marks a name directly in front of a parenthesis as a method', () => {
    expect(kindOf(tokenizeJava('    static int factorial(int n) {'), 'factorial')).toBe('method');
    expect(kindOf(tokenizeJava('        return n * factorial(n - 1);'), 'factorial')).toBe(
      'method',
    );
  });

  it('does not mistake a control-flow keyword for a method name', () => {
    const tokens = tokenizeJava('        if (n <= 1) {');

    expect(kindOf(tokens, 'if')).toBe('keyword');
    expect(tokens.some((token) => token.kind === 'method')).toBe(false);
  });

  it('marks capitalised names as type names', () => {
    const tokens = tokenizeJava('public final class Factorial {');

    expect(kindOf(tokens, 'Factorial')).toBe('type');
    expect(kindOf(tokens, 'public')).toBe('keyword');
  });

  it('marks number literals', () => {
    expect(kindOf(tokenizeJava('        return n * factorial(n - 1);'), '1')).toBe('number');
    expect(kindOf(tokenizeJava('        int result = gcd(1071, 462);'), '1071')).toBe('number');
  });

  it('leaves code inside a comment uncoloured', () => {
    const tokens = tokenizeJava('        int result = factorial(2); // int y');
    const comments = tokens.filter((token) => token.kind === 'comment');

    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe('// int y');
    // The `int` inside the comment must not leak out as a separate keyword token.
    expect(tokens.filter((token) => token.text === 'int')).toHaveLength(1);
  });

  it('does not tokenize the contents of a string literal', () => {
    const tokens = tokenizeJava('String label = "static int";');

    expect(kindOf(tokens, 'String')).toBe('type');
    expect(tokens.some((token) => token.kind === 'keyword')).toBe(false);
  });
});

describe('tokenizeJavaLines', () => {
  /** Every token of a line, so a whole javadoc can be asserted to be one colour. */
  function kindsOf(scanned: readonly (readonly Token[])[], line: number): readonly TokenKind[] {
    return [...new Set((scanned[line] ?? []).map((token) => token.kind))];
  }

  const JAVADOC = [
    '/**',
    ' * Bubble sort — {@code {5, 3, 4, 1, 2}} sorted in place.',
    ' *',
    ' * <p>The int values above must not read as number literals.',
    ' */',
    'public class BubbleSort {',
  ];

  it('colours every continuation line of a block comment as comment', () => {
    const scanned = tokenizeJavaLines(JAVADOC);

    for (const line of [0, 1, 2, 3, 4]) {
      expect(kindsOf(scanned, line)).toEqual(['comment']);
    }
  });

  it('goes back to reading code on the line after the comment closes', () => {
    const scanned = tokenizeJavaLines(JAVADOC);

    expect(kindOf(scanned[5] ?? [], 'public')).toBe('keyword');
    expect(kindOf(scanned[5] ?? [], 'BubbleSort')).toBe('type');
  });

  it('is what a line-at-a-time scan cannot do', () => {
    // The bug this exists for: alone, the continuation line has no `/*` on it, so `Bubble`
    // reads as a type name and the digits as literals.
    const alone = tokenizeJava(JAVADOC[1] ?? '');

    expect(alone.some((token) => token.kind === 'type')).toBe(true);
    expect(tokenizeJavaLines(JAVADOC)[1]?.every((token) => token.kind === 'comment')).toBe(true);
  });

  it('closes the comment mid-line and reads the rest as code', () => {
    const scanned = tokenizeJavaLines(['/* opening', 'still inside */ int n = 1;']);

    expect(kindOf(scanned[1] ?? [], ' int ')).toBeUndefined();
    expect(kindOf(scanned[1] ?? [], 'int')).toBe('keyword');
    expect(kindOf(scanned[1] ?? [], '1')).toBe('number');
    expect(scanned[1]?.[0]).toEqual({ kind: 'comment', text: 'still inside */' });
  });

  it('treats a comment opened and closed on one line as closed', () => {
    const scanned = tokenizeJavaLines(['int a = 1; /* note */', 'int b = 2;']);

    expect(kindOf(scanned[1] ?? [], 'int')).toBe('keyword');
    expect(kindOf(scanned[1] ?? [], '2')).toBe('number');
  });

  it('leaves a line ending in a bare /*/ open, since that never closed anything', () => {
    const scanned = tokenizeJavaLines(['int a = 1; /*/', 'int b = 2;']);

    expect(kindsOf(scanned, 1)).toEqual(['comment']);
  });

  it('keeps every line intact when its tokens are concatenated', () => {
    const lines = sourceLines();
    const scanned = tokenizeJavaLines(lines);

    for (const [index, line] of lines.entries()) {
      expect((scanned[index] ?? []).map((token) => token.text).join('')).toBe(line);
    }
  });
});
