export type ClassFileErrorDetail =
  | {
      readonly kind: 'bad-magic';
      readonly offset: number;
      readonly found: number;
    }
  | {
      readonly kind: 'truncated';
      readonly offset: number;
      readonly context: string;
      readonly bytesNeeded: number;
      readonly bytesAvailable: number;
    }
  | {
      readonly kind: 'unknown-constant-tag';
      readonly offset: number;
      readonly tag: number;
      readonly constantPoolIndex: number;
    }
  | {
      readonly kind: 'bad-index';
      readonly offset: number;
      readonly index: number;
      readonly expected: string;
      readonly context: string;
    }
  | {
      readonly kind: 'malformed-utf8';
      readonly offset: number;
      readonly constantPoolIndex: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'malformed-structure';
      readonly offset: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'malformed-descriptor';
      readonly descriptor: string;
      readonly position: number;
      readonly reason: string;
    };

export class ClassFileError extends Error {
  readonly detail: ClassFileErrorDetail;

  constructor(detail: ClassFileErrorDetail) {
    super(formatClassFileError(detail));
    this.name = 'ClassFileError';
    this.detail = detail;
  }
}

export function isClassFileError(error: unknown): error is ClassFileError {
  return error instanceof ClassFileError;
}

export function formatClassFileError(detail: ClassFileErrorDetail): string {
  switch (detail.kind) {
    case 'bad-magic':
      return `Not a .class file: expected the 0xcafebabe header, found ${hex(detail.found, 8)} (offset ${String(detail.offset)}).`;
    case 'truncated':
      return `Truncated file: ${detail.context} needs ${String(detail.bytesNeeded)} B, ${String(detail.bytesAvailable)} B available (offset ${String(detail.offset)}).`;
    case 'unknown-constant-tag':
      return `Unknown constant pool tag ${String(detail.tag)} in entry #${String(detail.constantPoolIndex)} (offset ${String(detail.offset)}): the pool cannot be read any further.`;
    case 'bad-index':
      return `Invalid constant pool index #${String(detail.index)} in ${detail.context}: expected a ${detail.expected} entry (offset ${String(detail.offset)}).`;
    case 'malformed-utf8':
      return `Malformed Utf8 string in entry #${String(detail.constantPoolIndex)} (offset ${String(detail.offset)}): ${detail.reason}.`;
    case 'malformed-structure':
      return `Malformed .class file structure (offset ${String(detail.offset)}): ${detail.reason}.`;
    case 'malformed-descriptor':
      return `Invalid descriptor "${detail.descriptor}" at position ${String(detail.position)}: ${detail.reason}.`;
  }
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, '0')}`;
}
