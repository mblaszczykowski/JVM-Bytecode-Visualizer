import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);

export const exampleEntrySchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be kebab-case (e.g. "sum-of-products")'),
    title: nonEmptyText,
    tagline: nonEmptyText.max(60),
    description: nonEmptyText,
    classFile: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.class$/),
    sourceFile: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.java$/),
    entryMethod: z.literal('main'),
    resultVariable: z.literal('result'),
    expectedResult: z.int().min(-2_147_483_648).max(2_147_483_647),
    expectedOutput: z.array(z.string()).optional(),
  })
  .strict();

export const exampleManifestSchema = z
  .object({
    version: z.literal(1),
    examples: z
      .array(exampleEntrySchema)
      .min(1)
      .refine(
        (examples) => new Set(examples.map((example) => example.id)).size === examples.length,
        { message: 'example identifiers must be unique' },
      ),
  })
  .strict();

export type ExampleEntry = z.infer<typeof exampleEntrySchema>;
export type ExampleManifest = z.infer<typeof exampleManifestSchema>;

export function parseExampleManifest(raw: unknown): ExampleManifest {
  return exampleManifestSchema.parse(raw);
}
