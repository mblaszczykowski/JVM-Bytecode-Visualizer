import { ClassFileError } from './errors';

/**
 * Cursor over a slice of an `ArrayBuffer` with big-endian reads of the `.class` format
 * (JVMS §4.1: all multi-byte values are stored big-endian).
 *
 * The only place in the domain layer that touches `DataView` — the I/O boundary. A read past
 * the window raises `ClassFileError` of kind `truncated` rather than a bare `RangeError`, so
 * the UI gets the byte offset and the name of the field the file was cut off at.
 */
export class ByteReader {
  private readonly source: ArrayBuffer;
  /** Absolute offset of the window start within the source buffer. */
  private readonly base: number;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  /** Cursor position relative to the window start. */
  private cursor = 0;

  constructor(
    buffer: ArrayBuffer,
    byteOffset = 0,
    byteLength = Math.max(0, buffer.byteLength - byteOffset),
  ) {
    if (
      !Number.isInteger(byteOffset) ||
      !Number.isInteger(byteLength) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset + byteLength > buffer.byteLength
    ) {
      throw new ClassFileError({
        kind: 'malformed-structure',
        offset: byteOffset,
        reason: `reader window [${String(byteOffset)}, ${String(byteOffset + byteLength)}) exceeds the ${String(buffer.byteLength)} B buffer`,
      });
    }

    this.source = buffer;
    this.base = byteOffset;
    this.view = new DataView(buffer, byteOffset, byteLength);
    this.bytes = new Uint8Array(buffer, byteOffset, byteLength);
  }

  /** Absolute cursor offset within the source buffer. */
  get offset(): number {
    return this.base + this.cursor;
  }

  /** Absolute offset of the window end. */
  get endOffset(): number {
    return this.base + this.view.byteLength;
  }

  get remaining(): number {
    return this.view.byteLength - this.cursor;
  }

  readU1(context = 'u1'): number {
    return this.view.getUint8(this.claim(1, context));
  }

  readU2(context = 'u2'): number {
    return this.view.getUint16(this.claim(2, context));
  }

  readU4(context = 'u4'): number {
    return this.view.getUint32(this.claim(4, context));
  }

  readI1(context = 'i1'): number {
    return this.view.getInt8(this.claim(1, context));
  }

  readI2(context = 'i2'): number {
    return this.view.getInt16(this.claim(2, context));
  }

  /** Copies, so the result does not alias the source buffer and is safe to keep in the model. */
  readBytes(count: number, context = 'bytes'): Uint8Array {
    const start = this.claim(count, context);
    return this.bytes.slice(start, start + count);
  }

  skip(count: number, context = 'skipped bytes'): void {
    this.claim(count, context);
  }

  /**
   * Carves out a reader limited to the next `length` bytes and advances the parent cursor past
   * them — the "skip every attribute by `attribute_length`" rule of JVMS §4.7. An attribute
   * parser cannot read a byte outside its own body, and the parent lands in the right place
   * regardless of what it read.
   */
  subReader(length: number, context = 'block'): ByteReader {
    const start = this.claim(length, context);
    return new ByteReader(this.source, this.base + start, length);
  }

  /**
   * Reserves `count` bytes and returns their position relative to the window. Every range
   * check lives here, which is what keeps `RangeError` out of the read methods.
   */
  private claim(count: number, context: string): number {
    if (!Number.isInteger(count) || count < 0) {
      throw new ClassFileError({
        kind: 'malformed-structure',
        offset: this.offset,
        reason: `the byte count to read (${context}) must be a non-negative integer, got ${String(count)}`,
      });
    }
    if (count > this.remaining) {
      throw new ClassFileError({
        kind: 'truncated',
        offset: this.offset,
        context,
        bytesNeeded: count,
        bytesAvailable: this.remaining,
      });
    }

    const start = this.cursor;
    this.cursor += count;
    return start;
  }
}
