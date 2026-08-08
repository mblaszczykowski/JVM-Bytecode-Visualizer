/**
 * Embedded mode: the same application, in somebody else's page.
 *
 * A run that can be linked to can also be shown in place, which is how a tool like this reaches
 * people who were not looking for it — an explanation of `iastore` is worth more next to the
 * paragraph that raised the question than three clicks away from it.
 *
 * The flag is a query parameter rather than a hash segment on purpose: the hash already
 * addresses a moment of a run (`deep-link.ts`) and belongs to the reader, while this addresses
 * how the page is being shown and belongs to whoever wrote the embed. Keeping them in separate
 * halves of the URL means an embed and a deep link compose without either knowing about the
 * other — `?embed#/bubble-sort/tour/the-swap/2` is just both at once.
 */

const FLAG = 'embed';

export function isEmbedded(search: string): boolean {
  return new URLSearchParams(search).has(FLAG);
}

/**
 * The same place, in the full application: everything except the flag survives, so following it
 * out of an iframe lands on the step or the tour stop that was on screen.
 */
export function fullAppUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FLAG);
  // An empty `?` left behind by the only parameter is noise in an address bar.
  url.search = url.searchParams.toString();
  return url.toString();
}
