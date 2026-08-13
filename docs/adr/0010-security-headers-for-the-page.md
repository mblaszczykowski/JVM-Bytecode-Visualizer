# ADR-0010: Security headers for the published page

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

The frontend is a static bundle on Vercel that parses and executes untrusted `.class` files in the
reader's tab. It has no accounts, no cookies and no session, so the usual reasons for tightening a
page do not apply in their usual form. What it does have is an `?embed` mode built to be put in an
iframe by someone else, an inline script that has to run before the first paint, and a compile
service whose origin is build-time configuration rather than a fixed host.

Without a record, the headers in `vercel.json` read as boilerplate, and the two holes in them read
as omissions rather than as choices.

## Decision

`vercel.json` sets four headers on every response.

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none';
  form-action 'none'; frame-ancestors *; img-src 'self' data:; font-src 'self';
  style-src 'self' 'unsafe-inline';
  script-src 'self' 'sha256-9j2vvgtIiIoWm3gSr9CKFBJdGnDQK1S0TOq1I6qgyfc=';
  worker-src 'self'; connect-src 'self' https:
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(),
  microphone=(), payment=(), usb=()
```

Five of the CSP directives are decisions rather than defaults.

- `frame-ancestors *`, and no `X-Frame-Options` at all. `?embed` exists so that a third party
  can put a run in their own page, which is a feature this project documents and shows an `<iframe>`
  snippet for. A restrictive `frame-ancestors`, or the `X-Frame-Options: DENY` that a header
  checklist would ask for, would break it. The page holds nothing worth clickjacking: no session, no
  destructive action, nothing a click can authorise. Omitting `X-Frame-Options` is part of the same
  decision, because it has no origin-list form that CSP does not express better and it would
  contradict `frame-ancestors`.
- `script-src 'self'` plus one sha256. `web/index.html` runs a short inline script before the
  bundle loads, reading the stored theme and stamping `data-theme` on the root element. It has to be
  inline and it has to be synchronous: a module runs after the first paint, so a reader who chose
  dark would see a white flash. Hashing it is what allows that one script without allowing
  `'unsafe-inline'` for scripts generally. The cost is a coupling: editing that script means
  recomputing the hash. The cost of getting it wrong is a theme flash on first paint, which is why
  this is an acceptable thing to couple.
- `style-src 'self' 'unsafe-inline'` is required. React writes `style` attributes, and framer-motion writes
  them on every animation frame. Neither can be hashed, because the values change per frame. This is
  the weakest directive here, and it follows from the rendering stack.
- `connect-src 'self' https:` is broad on purpose. The compile service and the telemetry endpoint are both build-time
  configuration (`VITE_COMPILE_API_URL`, `VITE_TELEMETRY_URL`) pointing at an origin this file
  cannot know. Naming them would mean regenerating `vercel.json` per deployment. `https:` at least
  rules out plaintext and non-HTTP schemes.
- `worker-src 'self'` is named explicitly. Execution moved into a worker in ADR-0006, and `default-src` would not
  have covered it in every browser.

Production source maps are emitted as `sourcemap: 'hidden'` in `web/vite.config.ts`: the `.map`
files are built and uploaded, and no `sourceMappingURL` comment points at them, so a browser never
fetches one and devtools open on the shipped bundle. They exist so that a frame from a production
build can be read back to source by loading the map by hand. Nothing does that automatically:
`web/src/services/telemetry.ts` sends an error name and two counters, never a stack and never a
message, and `telemetry.test.ts` pins the exact set of keys a report may carry.

## Consequences

**Positive**

- The two things a header scanner flags, `frame-ancestors *` and the missing `X-Frame-Options`, are
  on the record as intentional, with the reason written down.
- The inline theme script is allowed by hash, so `script-src` stays free of `'unsafe-inline'`, which
  is the directive that actually matters for a page that parses untrusted input.
- Nothing about this depends on Vercel. The same headers on any static host produce the same page.

**Negative / costs**

- The hash is a coupling between `vercel.json` and `web/index.html`: editing the script means
  recomputing it. `web/scripts/check-csp-hash.mjs` hashes the inline script and compares it to the
  directive, and the `web` workflow runs it on every change to either file, so the drift fails a
  build instead of reaching the deployed page as a theme flash.
- `style-src 'unsafe-inline'` is a real weakening, and it cannot be removed while framer-motion
  animates inline styles.
- `connect-src https:` is broad. It bounds the scheme and nothing else.

## Alternatives considered

- _A nonce instead of a hash for the inline script._ A nonce has to be generated per response, which
  a static deployment on a CDN cannot do without rendering the document at the edge. Rejected as a
  large amount of machinery for one short script.
- _Moving the theme script into the bundle._ Removes the inline script and the hash together, at the
  cost of a white flash on every load for readers who chose dark. The flash is the thing the script
  exists to prevent.
- _Pinning `connect-src` to the configured origins at build time._ Genuinely better, and it would
  mean generating `vercel.json` from the environment during the build. Worth doing if the deployment
  ever stops being a single static configuration; it is not worth a build step today.
