const FLAG = 'embed';

const DENIALS: readonly string[] = ['false', '0', 'no', 'off'];

export function isEmbedded(search: string): boolean {
  const value = new URLSearchParams(search).get(FLAG);
  return value !== null && !DENIALS.includes(value.trim().toLowerCase());
}

export function fullAppUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FLAG);
  return url.toString();
}
