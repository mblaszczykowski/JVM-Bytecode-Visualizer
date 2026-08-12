import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import { ByteReader } from './byte-reader';

function readerOf(...bytes: number[]): ByteReader {
  return new ByteReader(Uint8Array.from(bytes).buffer);
}

describe('ByteReader: unsigned reads', () => {
  it('reads u1, u2 and u4 big-endian (JVMS §4.1)', () => {
    const reader = readerOf(0x2a, 0x01, 0x02, 0xca, 0xfe, 0xba, 0xbe);

    expect(reader.readU1()).toBe(0x2a);
    expect(reader.readU2()).toBe(0x0102);
    expect(reader.readU4()).toBe(0xcafe_babe);
  });

  it('returns u4 as an unsigned number, also above 2^31', () => {
    const reader = readerOf(0xff, 0xff, 0xff, 0xff);

    expect(reader.readU4()).toBe(4_294_967_295);
  });
});

describe('ByteReader: signed reads', () => {
  it('reads 0xFF as -1 via readI1 and as 255 via readU1', () => {
    expect(readerOf(0xff).readI1()).toBe(-1);
    expect(readerOf(0xff).readU1()).toBe(255);
  });

  it('reads 0xFFFE as -2 via readI2 and as 65534 via readU2', () => {
    expect(readerOf(0xff, 0xfe).readI2()).toBe(-2);
    expect(readerOf(0xff, 0xfe).readU2()).toBe(65_534);
  });

  it('reads the extreme values of the signed types', () => {
    expect(readerOf(0x80).readI1()).toBe(-128);
    expect(readerOf(0x7f).readI1()).toBe(127);
    expect(readerOf(0x80, 0x00).readI2()).toBe(-32_768);
    expect(readerOf(0x7f, 0xff).readI2()).toBe(32_767);
  });

  it('reads i8 as a bigint, which keeps the values a double would round', () => {
    expect(readerOf(0, 0, 0, 1, 0, 0, 0, 0).readI8()).toBe(4_294_967_296n);
    expect(readerOf(0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff).readI8()).toBe(
      9_223_372_036_854_775_807n,
    );
    expect(readerOf(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff).readI8()).toBe(-1n);
  });
});

describe('ByteReader: IEEE 754 reads', () => {
  it('reads f4 as a single and f8 as a double (JVMS §4.4.4, §4.4.5)', () => {
    expect(readerOf(0x3f, 0xc0, 0x00, 0x00).readF4()).toBe(1.5);
    expect(readerOf(0x3f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00).readF8()).toBe(0.5);
  });

  it('widens a single to the double nearest to it', () => {
    expect(readerOf(0x3d, 0xcc, 0xcc, 0xcd).readF4()).toBe(0.10000000149011612);
  });

  it('reads the bit patterns that are not numbers', () => {
    expect(readerOf(0x7f, 0x80, 0x00, 0x00).readF4()).toBe(Number.POSITIVE_INFINITY);
    expect(readerOf(0x7f, 0xc0, 0x00, 0x00).readF4()).toBeNaN();
  });
});

describe('ByteReader: cursor', () => {
  it('advances the offset by the read size and decreases remaining', () => {
    const reader = readerOf(1, 2, 3, 4, 5, 6, 7);
    expect(reader.offset).toBe(0);
    expect(reader.remaining).toBe(7);
    expect(reader.endOffset).toBe(7);

    reader.readU1();
    reader.readU2();
    reader.readU4();

    expect(reader.offset).toBe(7);
    expect(reader.remaining).toBe(0);
  });

  it('skip jumps over bytes without reading them', () => {
    const reader = readerOf(1, 2, 3, 4);
    reader.skip(3);

    expect(reader.offset).toBe(3);
    expect(reader.readU1()).toBe(4);
  });

  it('readBytes returns a copy, so mutating it leaves the source buffer alone', () => {
    const source = Uint8Array.from([0x0a, 0x0b, 0x0c]);
    const reader = new ByteReader(source.buffer);

    const copy = reader.readBytes(3);
    copy[0] = 0xff;

    expect(Array.from(copy)).toEqual([0xff, 0x0b, 0x0c]);
    expect(Array.from(source)).toEqual([0x0a, 0x0b, 0x0c]);
  });

  it('readBytes(0) returns an empty array and does not move the cursor', () => {
    const reader = readerOf(1, 2);

    expect(reader.readBytes(0)).toHaveLength(0);
    expect(reader.offset).toBe(0);
  });
});

describe('ByteReader: reading past the buffer', () => {
  it('reports a typed truncated error instead of a DataView RangeError', () => {
    const reader = readerOf(0x01, 0x02);

    const detail = expectClassFileError(() => reader.readU4('major_version'));

    expect(detail).toEqual({
      kind: 'truncated',
      offset: 0,
      context: 'major_version',
      bytesNeeded: 4,
      bytesAvailable: 2,
    });
  });

  it('reports the offset where the cursor stopped', () => {
    const reader = readerOf(0x01, 0x02, 0x03);
    reader.readU2();

    const detail = expectClassFileError(() => reader.readU2('constant_pool_count'));

    expect(detail).toMatchObject({ kind: 'truncated', offset: 2, bytesAvailable: 1 });
  });

  it('leaves the cursor in place when a read fails', () => {
    const reader = readerOf(0x01);
    expectClassFileError(() => reader.readU2());

    expect(reader.offset).toBe(0);
    expect(reader.readU1()).toBe(0x01);
  });

  it('rejects negative and non-integer byte counts', () => {
    expect(
      expectClassFileError(() => {
        readerOf(1, 2).skip(-1);
      }),
    ).toMatchObject({ kind: 'malformed-structure' });
    expect(expectClassFileError(() => readerOf(1, 2).readBytes(1.5))).toMatchObject({
      kind: 'malformed-structure',
    });
  });

  it('rejects a window reaching outside the source buffer', () => {
    const buffer = Uint8Array.from([1, 2, 3]).buffer;

    expect(expectClassFileError(() => new ByteReader(buffer, 2, 4))).toMatchObject({
      kind: 'malformed-structure',
    });
  });
});

describe('ByteReader: subReader', () => {
  it('limits reads to the given length and moves the parent cursor past the block', () => {
    const reader = readerOf(0xaa, 0xbb, 0xcc, 0xdd);

    const body = reader.subReader(2, 'attribute');

    expect(body.readU1()).toBe(0xaa);
    expect(body.remaining).toBe(1);
    expect(reader.offset).toBe(2);
    expect(reader.readU2()).toBe(0xccdd);
  });

  it('does not let a block body reach beyond its length', () => {
    const reader = readerOf(0xaa, 0xbb, 0xcc, 0xdd);
    const body = reader.subReader(2);

    const detail = expectClassFileError(() => body.readU4('Code.code'));

    expect(detail).toMatchObject({ kind: 'truncated', bytesNeeded: 4, bytesAvailable: 2 });
  });

  it('reports absolute buffer offsets, not offsets relative to the block', () => {
    const reader = readerOf(0x00, 0x00, 0xaa, 0xbb);
    reader.skip(2);
    const body = reader.subReader(2);
    body.readU1();

    expect(body.offset).toBe(3);
    expect(body.endOffset).toBe(4);
    expect(expectClassFileError(() => body.readU2())).toMatchObject({ offset: 3 });
  });

  it('reports truncated when the declared block length exceeds the buffer', () => {
    const reader = readerOf(0x01, 0x02);

    expect(expectClassFileError(() => reader.subReader(8, 'attribute_length'))).toMatchObject({
      kind: 'truncated',
      context: 'attribute_length',
      bytesNeeded: 8,
      bytesAvailable: 2,
    });
  });
});
