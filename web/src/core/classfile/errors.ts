/**
 * Typowane błędy parsowania plików `.class` (plan.md §9 Faza 1, §11 pkt 3).
 *
 * Cała warstwa `classfile/` sygnalizuje awarie wyłącznie przez `ClassFileError` —
 * żadnych gołych `RangeError` z `DataView` ani `throw new Error(string)`. Wariant
 * błędu (`detail`) jest maszynowo czytelny (UI mapuje `kind` na komunikat w swoim
 * języku, plan.md §9 Faza 7), a `message` jest gotowym do pokazania opisem po polsku.
 */

/** Rodzaj awarii wraz z danymi potrzebnymi do zbudowania komunikatu. */
export type ClassFileErrorDetail =
  | {
      /** Plik nie zaczyna się od 0xCAFEBABE, czyli nie jest plikiem `.class` (JVMS §4.1). */
      readonly kind: 'bad-magic';
      readonly offset: number;
      readonly found: number;
    }
  | {
      /** Struktura wymaga bajtów, których w buforze (albo w ciele atrybutu) już nie ma. */
      readonly kind: 'truncated';
      readonly offset: number;
      /** Nazwa czytanego pola, np. `constant_pool[7].class_index`. */
      readonly context: string;
      readonly bytesNeeded: number;
      readonly bytesAvailable: number;
    }
  | {
      /**
       * Tag spoza JVMS §4.4 — wpisy constant poolu mają różne długości, więc bez
       * znajomości tagu nie da się przejść do następnego wpisu (plan.md §8 pkt 5).
       */
      readonly kind: 'unknown-constant-tag';
      readonly offset: number;
      readonly tag: number;
      readonly constantPoolIndex: number;
    }
  | {
      /** Indeks constant poolu poza zakresem, pusty (slot po Long/Double) albo złego rodzaju. */
      readonly kind: 'bad-index';
      readonly offset: number;
      readonly index: number;
      /** Oczekiwany rodzaj wpisu, np. `Utf8`. */
      readonly expected: string;
      readonly context: string;
    }
  | {
      /** Ciąg łamiący gramatykę zmodyfikowanego UTF-8 (JVMS §4.4.7). */
      readonly kind: 'malformed-utf8';
      readonly offset: number;
      readonly constantPoolIndex: number;
      readonly reason: string;
    }
  | {
      /** Liczności/rozmiary niespójne ze strukturą pliku (JVMS §4.1, §4.7.3). */
      readonly kind: 'malformed-structure';
      readonly offset: number;
      readonly reason: string;
    }
  | {
      /**
       * Deskryptor pola/metody niezgodny z gramatyką JVMS §4.3. Jedyny wariant bez
       * offsetu bajtowego: parser deskryptorów pracuje na stringu z constant poolu
       * (albo na literale z testu), więc miejsce błędu wskazuje indeksem znaku.
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

/** Komunikat gotowy do pokazania użytkownikowi (ErrorBanner, plan.md §9 Faza 7). */
export function formatClassFileError(detail: ClassFileErrorDetail): string {
  switch (detail.kind) {
    case 'bad-magic':
      return `To nie jest plik .class: oczekiwano nagłówka 0xcafebabe, znaleziono ${hex(detail.found, 8)} (offset ${String(detail.offset)}).`;
    case 'truncated':
      return `Plik urwany: ${detail.context} wymaga ${String(detail.bytesNeeded)} B, dostępne ${String(detail.bytesAvailable)} B (offset ${String(detail.offset)}).`;
    case 'unknown-constant-tag':
      return `Nieznany tag constant poolu ${String(detail.tag)} we wpisie #${String(detail.constantPoolIndex)} (offset ${String(detail.offset)}) — dalszego odczytu puli nie da się bezpiecznie kontynuować.`;
    case 'bad-index':
      return `Nieprawidłowy indeks constant poolu #${String(detail.index)} w ${detail.context}: oczekiwano wpisu ${detail.expected} (offset ${String(detail.offset)}).`;
    case 'malformed-utf8':
      return `Uszkodzony ciąg Utf8 we wpisie #${String(detail.constantPoolIndex)} (offset ${String(detail.offset)}): ${detail.reason}.`;
    case 'malformed-structure':
      return `Uszkodzona struktura pliku .class (offset ${String(detail.offset)}): ${detail.reason}.`;
    case 'malformed-descriptor':
      return `Nieprawidłowy deskryptor "${detail.descriptor}" na pozycji ${String(detail.position)}: ${detail.reason}.`;
  }
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, '0')}`;
}
