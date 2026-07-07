/**
 * Schemat `public/examples/manifest.json` — pliku generowanego przez
 * `fixtures/build-fixtures.mjs` (plan.md §7, §9 Faza 4).
 *
 * Manifest jest granicą I/O: przyjeżdża jako nieufany JSON (z `fetch` w przeglądarce albo
 * z dysku w teście) i dopiero walidacja zod zamienia go w typ domenowy. Typy pochodne
 * (`z.infer`) są jedynym źródłem prawdy o kształcie manifestu — nie duplikujemy ich ręcznie,
 * żeby nie mogły się rozjechać ze schematem.
 */

import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);

export const exampleEntrySchema = z
  .object({
    /** Stabilny identyfikator w kebab-case; klucz w URL-u i w testach różnicowych. */
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id musi być w kebab-case (np. "sum-of-squares")'),
    /** Nazwa przykładu w UI. */
    title: nonEmptyText,
    /** Edukacyjny opis: co przykład demonstruje w kategoriach bajtkodu. */
    description: nonEmptyText,
    /** Nazwa pliku w `public/examples/`, nie ścieżka — katalog jest ustalony. */
    classFile: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.class$/),
    sourceFile: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.java$/),
    /** Konwencja startu interpretera z plan.md §5.4. */
    entryMethod: z.literal('main'),
    /** Zmienna lokalna w `main`, do której przykład odkłada wynik (plan.md §5.4). */
    resultVariable: z.literal('result'),
    /**
     * Wynik policzony przez PRAWDZIWĄ JVM w trakcie builda fixtures — referencja testu
     * różnicowego. `int` JVM-owy, więc musi mieścić się w zakresie 32-bitowym ze znakiem.
     */
    expectedResult: z.int().min(-2_147_483_648).max(2_147_483_647),
  })
  .strict();

export const exampleManifestSchema = z
  .object({
    /** Wersja formatu manifestu; bump wymaga aktualizacji tego schematu. */
    version: z.literal(1),
    examples: z
      .array(exampleEntrySchema)
      .min(1)
      .refine(
        (examples) => new Set(examples.map((example) => example.id)).size === examples.length,
        { message: 'identyfikatory przykładów muszą być unikalne' },
      ),
  })
  .strict();

export type ExampleEntry = z.infer<typeof exampleEntrySchema>;
export type ExampleManifest = z.infer<typeof exampleManifestSchema>;

/**
 * Waliduje surowy JSON manifestu. Rzuca `z.ZodError` z pełną ścieżką błędu —
 * wołający decyduje, czy zamienić go na komunikat UI, czy uznać za błąd programisty.
 */
export function parseExampleManifest(raw: unknown): ExampleManifest {
  return exampleManifestSchema.parse(raw);
}
