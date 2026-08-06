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

/**
 * A block comment is the one construct that outlives the line it starts on, and a scanner
 * with no memory of that reads every continuation line as code: the ` * Bubble sort …` of a
 * javadoc came back with `Bubble` coloured as a type and the digits of `{5, 3, 4}` as number
 * literals. So a line is scanned against the state the previous line left behind, and hands
 * its own state to the next one.
 */
interface LineScan {
  readonly tokens: readonly Token[];
  /** Whether the line ended with a block comment still open. */
  readonly openComment: boolean;
}

// The shortest terminated block comment is four characters: slash, star, star, slash. Three
// characters — slash, star, slash — is an *opening* whose second star is doing double duty,
// and it ends in the same two characters a real terminator does. Hence the length test: the
// suffix alone would read that as opened and closed on the spot.
function isTerminated(comment: string): boolean {
  return comment.length >= 4 && comment.endsWith('*/');
}

function scanLine(line: string, openComment: boolean): LineScan {
  const tokens: Token[] = [];
  let from = 0;

  if (openComment) {
    const closes = line.indexOf('*/');
    if (closes < 0) {
      // The whole line is still inside the comment, and so is the start of the next one.
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

/**
 * Every line of a file, coloured with the block-comment state carried between them. This is
 * the entry point the Source panel uses; scanning a line on its own cannot be correct for
 * any file that contains a javadoc.
 */
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

/** Splits one line of Java into coloured tokens; concatenating them restores the line. */
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
