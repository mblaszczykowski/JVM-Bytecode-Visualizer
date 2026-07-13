/**
 * Typed `.class` parsing errors. The whole `classfile/` layer fails through `ClassFileError`
 * and nothing else — no bare `RangeError` from `DataView`, no `throw new Error(string)`.
 *
 * `detail` is machine-readable so the UI can map `kind` to its own wording; `message` is a
 * ready-to-display fallback.
 */

/** Failure kind together with the data needed to build a message. */
export type ClassFileErrorDetail =
  | {
      /** The file does not start with 0xCAFEBABE, so it is not a `.class` file (JVMS §4.1). */
      readonly kind: 'bad-magic';
      readonly offset: number;
      readonly found: number;
    }
  | {
      /** A structure needs bytes that the buffer (or the attribute body) no longer has. */
      readonly kind: 'truncated';
      readonly offset: number;
      /** Name of the field being read, e.g. `constant_pool[7].class_index`. */
      readonly context: string;
      readonly bytesNeeded: number;
      readonly bytesAvailable: number;
    }
  | {
      /**
       * A tag outside JVMS §4.4 — constant pool entries have different lengths, so without
       * knowing the tag there is no way to advance to the next entry.
       */
      readonly kind: 'unknown-constant-tag';
      readonly offset: number;
      readonly tag: number;
      readonly constantPoolIndex: number;
    }
  | {
      /** Constant pool index out of range, empty (a slot after Long/Double) or of the wrong kind. */
      readonly kind: 'bad-index';
      readonly offset: number;
      readonly index: number;
      /** Expected entry kind, e.g. `Utf8`. */
      readonly expected: string;
      readonly context: string;
    }
  | {
      /** A string violating the modified UTF-8 grammar (JVMS §4.4.7). */
      readonly kind: 'malformed-utf8';
      readonly offset: number;
      readonly constantPoolIndex: number;
      readonly reason: string;
    }
  | {
      /** Counts/sizes inconsistent with the file structure (JVMS §4.1, §4.7.3). */
      readonly kind: 'malformed-structure';
      readonly offset: number;
      readonly reason: string;
    }
  | {
      /**
       * A field/method descriptor violating the JVMS §4.3 grammar. The only variant without a
       * byte offset — the descriptor is a string pulled out of the constant pool, so the
       * failure is located by character index instead.
       */
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

/** Message ready to be shown to the user. */
export function formatClassFileError(detail: ClassFileErrorDetail): string {
  switch (detail.kind) {
    case 'bad-magic':
      return `Not a .class file: expected the 0xcafebabe header, found ${hex(detail.found, 8)} (offset ${String(detail.offset)}).`;
    case 'truncated':
      return `Truncated file: ${detail.context} needs ${String(detail.bytesNeeded)} B, ${String(detail.bytesAvailable)} B available (offset ${String(detail.offset)}).`;
    case 'unknown-constant-tag':
      return `Unknown constant pool tag ${String(detail.tag)} in entry #${String(detail.constantPoolIndex)} (offset ${String(detail.offset)}) — the pool cannot be read any further safely.`;
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
