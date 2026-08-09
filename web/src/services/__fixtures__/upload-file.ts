export function uploadFile(name: string, bytes: Uint8Array<ArrayBuffer>): File {
  const file = new File([bytes], name);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(buffer),
  });
  return file;
}
