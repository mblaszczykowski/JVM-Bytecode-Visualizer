/**
 * jsdom implements `File` without `arrayBuffer()` (browsers have had it since 2020), so the
 * upload path cannot read a plain jsdom `File`. The gap is filled here rather than in the
 * application code — the real read is covered by the Playwright upload spec.
 */
export function uploadFile(name: string, bytes: Uint8Array<ArrayBuffer>): File {
  const file = new File([bytes], name);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(buffer),
  });
  return file;
}
