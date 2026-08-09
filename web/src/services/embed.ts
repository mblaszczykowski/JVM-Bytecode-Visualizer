const FLAG = 'embed';

export function isEmbedded(search: string): boolean {
  return new URLSearchParams(search).has(FLAG);
}

export function fullAppUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FLAG);
  url.search = url.searchParams.toString();
  return url.toString();
}
