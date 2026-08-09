import { ClassFileError } from './errors';

export class ByteReader {
  private readonly source: ArrayBuffer;
  private readonly base: number;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
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

  get offset(): number {
    return this.base + this.cursor;
  }

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

  readBytes(count: number, context = 'bytes'): Uint8Array {
    const start = this.claim(count, context);
    return this.bytes.slice(start, start + count);
  }

  skip(count: number, context = 'skipped bytes'): void {
    this.claim(count, context);
  }

  subReader(length: number, context = 'block'): ByteReader {
    const start = this.claim(length, context);
    return new ByteReader(this.source, this.base + start, length);
  }

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
