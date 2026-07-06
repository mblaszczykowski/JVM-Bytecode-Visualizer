import { describe, expect, it } from 'vitest';

import { expectClassFileError } from './__fixtures__/expect-class-file-error';
import { ByteReader } from './byte-reader';

function readerOf(...bytes: number[]): ByteReader {
  return new ByteReader(Uint8Array.from(bytes).buffer);
}

describe('ByteReader — odczyty bez znaku', () => {
  it('czyta u1, u2 i u4 big-endian (JVMS §4.1)', () => {
    const reader = readerOf(0x2a, 0x01, 0x02, 0xca, 0xfe, 0xba, 0xbe);

    expect(reader.readU1()).toBe(0x2a);
    expect(reader.readU2()).toBe(0x0102);
    expect(reader.readU4()).toBe(0xcafe_babe);
  });

  it('zwraca u4 jako liczbę bez znaku, także powyżej 2^31', () => {
    const reader = readerOf(0xff, 0xff, 0xff, 0xff);

    expect(reader.readU4()).toBe(4_294_967_295);
  });
});

describe('ByteReader — odczyty ze znakiem', () => {
  it('czyta 0xFF jako -1 przez readI1 i jako 255 przez readU1', () => {
    expect(readerOf(0xff).readI1()).toBe(-1);
    expect(readerOf(0xff).readU1()).toBe(255);
  });

  it('czyta 0xFFFE jako -2 przez readI2 i jako 65534 przez readU2', () => {
    expect(readerOf(0xff, 0xfe).readI2()).toBe(-2);
    expect(readerOf(0xff, 0xfe).readU2()).toBe(65_534);
  });

  it('czyta wartości skrajne typów ze znakiem', () => {
    expect(readerOf(0x80).readI1()).toBe(-128);
    expect(readerOf(0x7f).readI1()).toBe(127);
    expect(readerOf(0x80, 0x00).readI2()).toBe(-32_768);
    expect(readerOf(0x7f, 0xff).readI2()).toBe(32_767);
  });
});

describe('ByteReader — kursor', () => {
  it('przesuwa offset o rozmiar odczytu i zmniejsza remaining', () => {
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

  it('skip przeskakuje bajty bez ich odczytywania', () => {
    const reader = readerOf(1, 2, 3, 4);
    reader.skip(3);

    expect(reader.offset).toBe(3);
    expect(reader.readU1()).toBe(4);
  });

  it('readBytes zwraca kopię — mutacja wyniku nie rusza bufora źródłowego', () => {
    const source = Uint8Array.from([0x0a, 0x0b, 0x0c]);
    const reader = new ByteReader(source.buffer);

    const copy = reader.readBytes(3);
    copy[0] = 0xff;

    expect(Array.from(copy)).toEqual([0xff, 0x0b, 0x0c]);
    expect(Array.from(source)).toEqual([0x0a, 0x0b, 0x0c]);
  });

  it('readBytes(0) zwraca pustą tablicę i nie rusza kursora', () => {
    const reader = readerOf(1, 2);

    expect(reader.readBytes(0)).toHaveLength(0);
    expect(reader.offset).toBe(0);
  });
});

describe('ByteReader — przekroczenie bufora', () => {
  it('zgłasza typowany błąd truncated zamiast RangeError z DataView', () => {
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

  it('raportuje offset w miejscu, w którym kursor się zatrzymał', () => {
    const reader = readerOf(0x01, 0x02, 0x03);
    reader.readU2();

    const detail = expectClassFileError(() => reader.readU2('constant_pool_count'));

    expect(detail).toMatchObject({ kind: 'truncated', offset: 2, bytesAvailable: 1 });
  });

  it('nie przesuwa kursora, gdy odczyt się nie powiódł', () => {
    const reader = readerOf(0x01);
    expectClassFileError(() => reader.readU2());

    expect(reader.offset).toBe(0);
    expect(reader.readU1()).toBe(0x01);
  });

  it('odrzuca ujemną i niecałkowitą liczbę bajtów', () => {
    expect(
      expectClassFileError(() => {
        readerOf(1, 2).skip(-1);
      }),
    ).toMatchObject({ kind: 'malformed-structure' });
    expect(expectClassFileError(() => readerOf(1, 2).readBytes(1.5))).toMatchObject({
      kind: 'malformed-structure',
    });
  });

  it('odrzuca okno wykraczające poza bufor źródłowy', () => {
    const buffer = Uint8Array.from([1, 2, 3]).buffer;

    expect(expectClassFileError(() => new ByteReader(buffer, 2, 4))).toMatchObject({
      kind: 'malformed-structure',
    });
  });
});

describe('ByteReader — subReader', () => {
  it('ogranicza odczyt do zadanej długości i przesuwa kursor rodzica za blok', () => {
    const reader = readerOf(0xaa, 0xbb, 0xcc, 0xdd);

    const body = reader.subReader(2, 'atrybut');

    expect(body.readU1()).toBe(0xaa);
    expect(body.remaining).toBe(1);
    expect(reader.offset).toBe(2);
    expect(reader.readU2()).toBe(0xccdd);
  });

  it('nie pozwala ciału bloku sięgnąć poza jego długość', () => {
    const reader = readerOf(0xaa, 0xbb, 0xcc, 0xdd);
    const body = reader.subReader(2);

    const detail = expectClassFileError(() => body.readU4('Code.code'));

    expect(detail).toMatchObject({ kind: 'truncated', bytesNeeded: 4, bytesAvailable: 2 });
  });

  it('raportuje offsety bezwzględne w buforze, nie względem bloku', () => {
    const reader = readerOf(0x00, 0x00, 0xaa, 0xbb);
    reader.skip(2);
    const body = reader.subReader(2);
    body.readU1();

    expect(body.offset).toBe(3);
    expect(body.endOffset).toBe(4);
    expect(expectClassFileError(() => body.readU2())).toMatchObject({ offset: 3 });
  });

  it('zgłasza truncated, gdy deklarowana długość bloku przekracza bufor', () => {
    const reader = readerOf(0x01, 0x02);

    expect(expectClassFileError(() => reader.subReader(8, 'attribute_length'))).toMatchObject({
      kind: 'truncated',
      context: 'attribute_length',
      bytesNeeded: 8,
      bytesAvailable: 2,
    });
  });
});
