import { describe, expect, it } from 'vitest';

import { sourceLines } from './__fixtures__/factorial-run';
import { type Token, type TokenKind, tokenizeJava } from './syntax';

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
