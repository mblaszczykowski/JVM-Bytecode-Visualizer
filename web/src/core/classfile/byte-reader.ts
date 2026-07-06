import { ClassFileError } from './errors';

/**
 * Kursor nad fragmentem `ArrayBuffer` z big-endianowymi odczytami formatu `.class`
 * (JVMS §4.1: wszystkie wielobajtowe wartości są zapisane big-endian).
 *
 * To jedyne miejsce w warstwie domenowej, które dotyka `DataView` — granica I/O
 * z plan.md §11 pkt 2. Każde przekroczenie okna kończy się `ClassFileError`
 * z rodzajem `truncated` (a nie gołym `RangeError` z `DataView`), dzięki czemu UI
 * dostaje offset bajtowy i nazwę pola, na którym plik się urwał.
 */
export class ByteReader {
  private readonly source: ArrayBuffer;
  /** Absolutny offset początku okna w buforze źródłowym. */
  private readonly base: number;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  /** Pozycja kursora względem początku okna. */
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
        reason: `okno czytnika [${String(byteOffset)}, ${String(byteOffset + byteLength)}) wykracza poza bufor o rozmiarze ${String(buffer.byteLength)} B`,
      });
    }

    this.source = buffer;
    this.base = byteOffset;
    this.view = new DataView(buffer, byteOffset, byteLength);
    this.bytes = new Uint8Array(buffer, byteOffset, byteLength);
  }

  /** Absolutny offset kursora w buforze źródłowym — w komunikatach błędów. */
  get offset(): number {
    return this.base + this.cursor;
  }

  /** Absolutny offset końca okna. */
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

  /** Kopia `count` bajtów — wynik nie aliasuje bufora wejściowego, więc jest bezpieczny do trzymania w modelu. */
  readBytes(count: number, context = 'bajty'): Uint8Array {
    const start = this.claim(count, context);
    return this.bytes.slice(start, start + count);
  }

  skip(count: number, context = 'pomijane bajty'): void {
    this.claim(count, context);
  }

  /**
   * Wydziela czytnik ograniczony do kolejnych `length` bajtów i przesuwa kursor rodzica
   * za nie. Tak realizowana jest reguła „każdy atrybut pomijamy po `attribute_length`”
   * (plan.md §8 pkt 4, JVMS §4.7): parser atrybutu nie jest w stanie przeczytać ani
   * bajtu spoza jego ciała, a rodzic i tak stoi w poprawnym miejscu.
   */
  subReader(length: number, context = 'blok'): ByteReader {
    const start = this.claim(length, context);
    return new ByteReader(this.source, this.base + start, length);
  }

  /**
   * Rezerwuje `count` bajtów i zwraca ich pozycję względem okna; przesuwa kursor.
   * Wszystkie kontrole zakresu są tutaj — metody odczytu nie mogą już rzucić `RangeError`.
   */
  private claim(count: number, context: string): number {
    if (!Number.isInteger(count) || count < 0) {
      throw new ClassFileError({
        kind: 'malformed-structure',
        offset: this.offset,
        reason: `liczba bajtów do odczytu (${context}) musi być nieujemną liczbą całkowitą, otrzymano ${String(count)}`,
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
