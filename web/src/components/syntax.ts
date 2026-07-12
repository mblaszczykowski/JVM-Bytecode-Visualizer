/**
 * Minimal Java tokenizer for the Source panel.
 *
 * The example programs are a deliberately small subset of Java (int arithmetic, static
 * methods, loops), so a highlighting library would add tens of kilobytes to colour four
 * files. This covers exactly the four categories the design colours — keywords, method
 * names, type names and number literals — and leaves everything else as plain text.
 */

export type TokenKind = 'keyword' | 'method' | 'type' | 'number' | 'comment' | 'text';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'var',
  'void',
  'volatile',
  'while',
  // Literals read as keywords in every Java editor.
  'false',
  'null',
  'true',
]);

/**
 * Comment, string literal, char literal, identifier, number — in that order, because the
 * first three swallow characters that would otherwise be tokenized as code.
 */
const PATTERN =
  /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][A-Za-z0-9_$]*|0[xXbB][0-9a-fA-F_]+[lL]?|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[lLfFdD]?/g;

function classifyWord(word: string, rest: string): TokenKind {
  if (KEYWORDS.has(word)) {
    return 'keyword';
  }
  // A name directly in front of `(` is a call or a declaration; keywords were excluded above.
  if (/^\s*\(/.test(rest)) {
    return 'method';
  }
  return /^[A-Z]/.test(word) ? 'type' : 'text';
}

function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text.length === 0) {
    return;
  }
  const last = tokens.at(-1);
  if (last?.kind === kind) {
    tokens[tokens.length - 1] = { kind, text: last.text + text };
    return;
  }
  tokens.push({ kind, text });
}

/** Splits one line of Java into coloured tokens; concatenating them restores the line. */
export function tokenizeJava(line: string): readonly Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(line);

  while (match !== null) {
    push(tokens, 'text', line.slice(cursor, match.index));

    const value = match[0];
    const first = value[0];
    if (value.startsWith('//') || value.startsWith('/*')) {
      push(tokens, 'comment', value);
    } else if (first === '"' || first === "'") {
      push(tokens, 'text', value);
    } else if (first !== undefined && /[0-9]/.test(first)) {
      push(tokens, 'number', value);
    } else {
      push(tokens, classifyWord(value, line.slice(match.index + value.length)), value);
    }

    cursor = match.index + value.length;
    match = PATTERN.exec(line);
  }

  push(tokens, 'text', line.slice(cursor));
  return tokens;
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-syntax-keyword',
  method: 'text-syntax-method',
  type: 'text-syntax-type',
  number: 'text-syntax-number',
  comment: 'text-white/32',
  text: '',
};
