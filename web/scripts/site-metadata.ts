export function siteMetadata(environment: Readonly<Record<string, string | undefined>>) {
  const requested = environment.VITE_PUBLIC_SITE_URL?.trim();
  const explicit = requested === '' ? undefined : requested;
  const host = environment.VERCEL_PROJECT_PRODUCTION_URL ?? environment.VERCEL_URL;
  const configured = explicit ?? (host ? `https://${host}` : undefined);
  let origin: string | undefined;
  if (configured !== undefined) {
    const url = new URL(configured);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error(
        'VITE_PUBLIC_SITE_URL must be an HTTP(S) origin without a path or credentials.',
      );
    }
    origin = url.origin;
  }

  return {
    name: 'site-metadata',
    transformIndexHtml(html: string) {
      return origin === undefined
        ? html
        : html.replace('content="/og-image.jpg"', `content="${origin}/og-image.jpg"`);
    },
  };
}
