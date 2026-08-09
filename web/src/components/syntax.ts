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
  'false',
  'null',
  'true',
]);

const PATTERN =
  /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][A-Za-z0-9_$]*|0[xXbB][0-9a-fA-F_]+[lL]?|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[lLfFdD]?/g;

function classifyWord(word: string, rest: string): TokenKind {
  if (KEYWORDS.has(word)) {
    return 'keyword';
  }
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

interface LineScan {
  readonly tokens: readonly Token[];
  readonly openComment: boolean;
}

function isTerminated(comment: string): boolean {
  return comment.length >= 4 && comment.endsWith('*/');
}

function scanLine(line: string, openComment: boolean): LineScan {
  const tokens: Token[] = [];
  let from = 0;

  if (openComment) {
    const closes = line.indexOf('*/');
    if (closes < 0) {
      push(tokens, 'comment', line);
      return { tokens, openComment: true };
    }
    push(tokens, 'comment', line.slice(0, closes + 2));
    from = closes + 2;
  }

  const rest = line.slice(from);
  let cursor = 0;
  let stillOpen = false;

  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(rest);

  while (match !== null) {
    push(tokens, 'text', rest.slice(cursor, match.index));

    const value = match[0];
    const first = value[0];
    if (value.startsWith('//') || value.startsWith('/*')) {
      push(tokens, 'comment', value);
      stillOpen = value.startsWith('/*') && !isTerminated(value);
    } else if (first === '"' || first === "'") {
      push(tokens, 'text', value);
    } else if (first !== undefined && /[0-9]/.test(first)) {
      push(tokens, 'number', value);
    } else {
      push(tokens, classifyWord(value, rest.slice(match.index + value.length)), value);
    }

    cursor = match.index + value.length;
    match = PATTERN.exec(rest);
  }

  push(tokens, 'text', rest.slice(cursor));
  return { tokens, openComment: stillOpen };
}

export function tokenizeJavaLines(lines: readonly string[]): readonly (readonly Token[])[] {
  const scanned: (readonly Token[])[] = [];
  let openComment = false;

  for (const line of lines) {
    const result = scanLine(line, openComment);
    scanned.push(result.tokens);
    openComment = result.openComment;
  }

  return scanned;
}

export function tokenizeJava(line: string): readonly Token[] {
  return scanLine(line, false).tokens;
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: 'text-syntax-keyword',
  method: 'text-syntax-method',
  type: 'text-syntax-type',
  number: 'text-syntax-number',
  comment: 'text-fg-3',
  text: '',
};
