import { describe, expect, it } from 'vitest';

import { siteMetadata } from './site-metadata';

const HTML = '<meta property="og:image" content="/og-image.jpg" />';

describe('deployed social image', () => {
  it('keeps a local build portable', () => {
    expect(siteMetadata({}).transformIndexHtml(HTML)).toBe(HTML);
  });

  it('uses the production domain on Vercel previews', () => {
    const plugin = siteMetadata({
      VERCEL_PROJECT_PRODUCTION_URL: 'visualizer.example',
      VERCEL_URL: 'preview.vercel.app',
    });
    expect(plugin.transformIndexHtml(HTML)).toContain(
      'content="https://visualizer.example/og-image.jpg"',
    );
  });

  it('prefers an explicit origin and normalizes its trailing slash', () => {
    const plugin = siteMetadata({
      VITE_PUBLIC_SITE_URL: ' https://custom.example/ ',
      VERCEL_PROJECT_PRODUCTION_URL: 'visualizer.example',
    });
    expect(plugin.transformIndexHtml(HTML)).toContain(
      'content="https://custom.example/og-image.jpg"',
    );
  });

  it.each([
    'javascript:alert(1)',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com/?q=1',
  ])('rejects an invalid site origin: %s', (url) => {
    expect(() => siteMetadata({ VITE_PUBLIC_SITE_URL: url })).toThrow();
  });
});
