# Deployment

There are two deployables and they do not depend on each other. The frontend is a static bundle (the
parser, the disassembler and the interpreter all run in the browser) and the compile service is a
container that turns Java source into class bytes for the optional editor. The application is
complete without the server: the bundled examples and `.class` upload cover the whole visualization
flow, and the editor tab only appears when a compile service is configured _and_ answers a health
check ([ADR-0004](adr/0004-backend-as-progressive-enhancement.md)).

So the frontend can go live on its own, and the backend can be added, restarted or removed later
without touching it.

| What                           | Where           | Built from                                  | Config                                  |
| ------------------------------ | --------------- | ------------------------------------------- | --------------------------------------- |
| `web/`: the visualizer         | Vercel (static) | `npm --workspace web run build`             | [`vercel.json`](../vercel.json)         |
| `server/`: the compile service | Fly.io          | [`server/Dockerfile`](../server/Dockerfile) | [`server/fly.toml`](../server/fly.toml) |

Neither deploy is wired into CI. `.github/workflows/` runs five workflows (`web`, `server`, `e2e`,
`codeql` and `docs`) covering lint, types, unit tests, the corpus, a fixture drift check, the
Playwright suite, `mvn verify` and prose; the deploys are a Vercel git integration and a
`fly deploy` you run yourself.

## Frontend on Vercel

1. Import the repository in Vercel and leave **Root Directory** at the repository root, not `web/`.
   The build is a workspace command and needs the root `package.json` and `package-lock.json`.
2. Leave the build settings alone. `vercel.json` supplies them:
   - `installCommand: npm ci`, a deterministic install of every workspace from the committed
     lockfile.
   - `buildCommand: npm --workspace web run build`, the same `tsc -b && vite build` that CI runs, so
     a type error fails the deploy instead of shipping.
   - `outputDirectory: web/dist`.
   - `framework: null`, because the build is stated explicitly. Framework detection would look for a
     Vite project at the root of the repository, where there is only a workspace manifest.
   - The `rewrites` entry is the single-page-app fallback. Vercel checks the filesystem before
     rewrites, so real files still win; only a path with nothing behind it falls back to
     `index.html`, which is what a client-side route needs.
   - The first `headers` entry marks `/assets/*` immutable. Those filenames are content-hashed by
     Vite. `public/examples/` is left on the default caching, because those filenames are stable and
     their contents can be regenerated.
   - The second sets the security headers on every response: `Content-Security-Policy`,
     `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. The CSP has one moving
     part: `script-src` carries a sha256 of the inline theme script in `web/index.html`, so editing
     that script means recomputing the hash. [ADR-0010](adr/0010-security-headers-for-the-page.md)
     covers what each directive is for and what breaks if it is wrong.
3. Node version: 20 or 22. The root `package.json` requires `node >= 20.18.1`.
4. Environment variables: none are required. To light up the Java editor, add `VITE_COMPILE_API_URL`
   with the base URL of the compile service, scheme and host only, no trailing slash and no path:

   ```
   VITE_COMPILE_API_URL = https://<your-fly-app>.fly.dev
   ```

   Vite inlines this at build time, so a change only takes effect on the next deploy. Unset, the
   editor tab does not exist and nothing else changes.

5. Deploy, then load the site: the bundled examples should replay, and dragging a `.class` file onto
   the window should load it.

## Backend on Fly.io

Prerequisites: [flyctl](https://fly.io/docs/flyctl/install/) and an account.

1. Reserve a name. App names are global, so pick something specific:

   ```bash
   fly apps create your-compile-service
   ```

   Avoid `fly launch` here. It rewrites `fly.toml` from its own detection and would discard the
   configuration in this repository.

2. Fill in [`server/fly.toml`](../server/fly.toml): the `app` name, the `primary_region` nearest
   your users (`fly platform regions` lists them) and `COMPILE_SERVICE_ALLOWED_ORIGIN`.

3. Deploy from `server/`:

   ```bash
   cd server
   fly deploy
   ```

   The build context is `server/`, which is what the Dockerfile expects; `server/.dockerignore`
   keeps `target/` and the Maven wrapper out of it.

4. Verify:

   ```bash
   curl -fsS https://<your-app>.fly.dev/actuator/health
   # {"status":"UP"}

   curl -i -X POST https://<your-app>.fly.dev/api/compile \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://<your-vercel-domain>' \
     -d '{"source":"public class Foo { public static void main(String[] a) { int x = 1 + 1; } }"}'
   ```

   The response should be `200` with `"success": true`, and the headers must include
   `access-control-allow-origin`. A missing CORS header means `COMPILE_SERVICE_ALLOWED_ORIGIN` does
   not match the browser's origin: scheme, host and port all have to be the same. A trailing slash
   is the one difference that does not matter, because Spring's `CorsConfiguration` trims it.

### Environment

Set on the machine through `[env]` in `fly.toml`. None of these are secrets, so keeping them in the
file makes the deployed configuration reviewable. `fly secrets set NAME=value` works too if you
would rather not commit the domain, and it restarts the machine on its own.

| Variable                                      | Default                 | What it does                                                                                                                                                                             |
| --------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPILE_SERVICE_ALLOWED_ORIGIN`              | `http://localhost:5173` | The one origin CORS allows, for `POST` and `OPTIONS` only. `*` is refused at start-up: a wildcard would let any page drive the compiler.                                                 |
| `PORT`                                        | `8080`                  | The port the server binds. Has to match `internal_port` in `fly.toml`.                                                                                                                   |
| `COMPILE_SERVICE_TRUST_FORWARDED_FOR`         | `false`                 | Whether `X-Forwarded-For` identifies the client for rate limiting. On behind Fly's proxy; off anywhere the header is not appended by a proxy you control, because a client can forge it. |
| `COMPILE_SERVICE_TRUSTED_PROXY_HOPS`          | `1`                     | How many proxies append to that header. The client address is counted that many entries from the right; everything to the left of it is caller-written.                                  |
| `COMPILE_SERVICE_MAX_CONCURRENT_COMPILATIONS` | `2`                     | Compile slots. Each one is a child JVM; once they are all taken the service answers `503` with `Retry-After` instead of queueing.                                                        |

The rest of the limits live in `server/src/main/resources/application.yml` and are not
environment-driven by default: 10 requests per minute per IP, a 64 KiB source, a 256 KiB request
body and a 10 s compile deadline. Spring Boot's relaxed binding still reaches them if a deployment
needs to differ: `COMPILE_TIMEOUT`, `COMPILE_RATELIMIT_REQUESTSPERMINUTE`.

One health indicator is turned off there: `management.health.diskspace`. The service never touches
the filesystem, and on a container whose rootfs had filled up the indicator reported DOWN, the
frontend's health check failed, and the editor disappeared for a reason that had nothing to do with
compiling.

### What the API answers on a failure

Every failure leaves as `{ error, message }`. The `error` values the service names are
`no-public-class`, `source-too-large`, `invalid-request`, `rate-limit-exceeded`, `compiler-busy`,
`compiler-unavailable`, `internal-error` and `request-error`. Anything Spring answers that nothing
maps explicitly gets a code derived from the HTTP status name, so a 405 reads `method-not-allowed`
and a 415 `unsupported-media-type`; the shape stays the same either way, which is what the client's
schema depends on. A blank source is one of the `invalid-request` cases: `@NotBlank` on the request
DTO rejects it before the service runs.

Two of these are worth knowing when reading logs. `compiler-busy` means every compile slot was
taken and is pure backpressure. `compiler-unavailable` means the child JVM could not be run at all,
and is the one that indicates something wrong with the deployment rather than with the load. Both
answer 503 with `Retry-After: 5`; the rate limiter answers 429 with `Retry-After: 60`.

A compile that hits the 10 s deadline is not one of these. It answers 200 with `success: false` and
a diagnostic, because from the caller's side the source is what did not compile.

The exact bytes of each of these responses are committed under
`server/src/test/resources/contract/`, one file per case. The server's tests assert it produces
them and the web client's tests parse them, so changing a status or a code fails on both sides.

### Sizing and image requirements

- Memory. This needs arithmetic rather than a rule of thumb, and it has its own section below.
- The runtime is a JDK, not a JRE. The service compiles Java on demand, and without the
  `jdk.compiler` module there is no compiler to run. The Dockerfile already uses a JDK image; keep
  it that way.
- The application runs exploded, not as `java -jar app.jar`. A compilation happens in a child JVM
  launched with the parent's `java.class.path`, and inside a repackaged Spring Boot jar the
  application classes sit under `BOOT-INF`, where a plain `java -cp` cannot find them. The
  Dockerfile unpacks the jar for exactly this reason, and the service logs an error at start-up if
  it ever finds itself packaged the other way.
- Cold starts. With `auto_stop_machines`, a machine that has been idle stops, and the first request
  afterwards pays a JVM start-up. The frontend gives the health check two seconds before it decides
  the service is not there, so after a stop the editor may be missing on the first visit and present
  on the second. Set `min_machines_running = 1` if that matters more than the idle cost.

### Sizing the machine

`-Xmx128m` bounds the child's heap. It does not bound the child. Five flags in
`ForkedCompiler.CHILD_VM_OPTIONS` bound five different regions:

| Flag                            | Region              | Bound            |
| ------------------------------- | ------------------- | ---------------- |
| `-Xmx128m`                      | heap                | 128 MB           |
| `-XX:MaxMetaspaceSize=64m`      | metaspace           | 64 MB            |
| `-XX:ReservedCodeCacheSize=32m` | JIT code cache      | 32 MB            |
| `-XX:MaxDirectMemorySize=16m`   | direct byte buffers | 16 MB            |
| `-Xss1m`                        | thread stack        | 1 MB, per thread |

The first four total **240 MB**. `-Xss1m` is a size per thread rather than a total, so it does not
add a fifth term; it keeps a compiler that recurses deeply from reserving a large stack, and javac
runs few enough threads that the sum stays under a megabyte or two. Beyond those, no flag bounds GC
structures, thread-local allocation, symbol tables or the JVM's own bookkeeping, which run to
roughly 25 MB. So the figure to size against is **about 270 MB per concurrent compilation**.

What a real compile actually commits, measured with Native Memory Tracking:

| Region               | Committed  |
| -------------------- | ---------- |
| Heap (pre-committed) | 128 MB     |
| Metaspace            | 15 MB      |
| Code cache           | 6 MB       |
| Thread stacks        | 0.5 MB     |
| Everything else      | ~34 MB     |
| **Total**            | **184 MB** |

plus a 14 MB file-backed CDS archive, which is shared between processes and mapped rather than
allocated.

The gap between 270 and 184 is javac not filling regions it was allowed to fill. It is a
comfortable margin rather than a smaller budget: nothing in the configuration keeps a pathological
source from using the metaspace it was granted.

#### The parent

`-XX:MaxRAMPercentage=25` in the Dockerfile caps the parent's heap at a quarter of the machine,
which on the shipped 1 GB is **256 MB**. That flag bounds the heap and nothing else, exactly as
`-Xmx128m` does for a child. The parent's metaspace, code cache, thread stacks and GC structures are
unbounded, and for a Spring Boot service that validates a string and forks a process they come to
roughly 120 MB, so the parent sits at about **375 MB of RSS** in total.

A quarter is a small share for the process that serves every request. It works because this service
holds no state between requests: it validates a string, forks a process and streams the answer back,
so the memory that decides the sizing is the children's.

#### The arithmetic

The shipped `fly.toml` is a 1 GB machine with `max-concurrent-compilations = 2`. On the bounds:

```
parent heap    256 MB
2 children   + 540 MB   (2 x 270)
             ---------
               796 MB   against 1024
```

The 228 MB that leaves is where the parent's own non-heap regions come from. Counting those instead
of the parent's heap alone puts the full worst case at about **915 MB**, leaving roughly **109 MB**
for the operating system and page cache. Read that as a bound rather than a forecast: it is what the
configuration permits, and nothing has been observed getting near it.

What it does in the ordinary case is smaller. With the measured 184 MB per child, a machine running
two concurrent compilations sits near **743 MB** (375 + 368), and one that is idle sits at the
parent's 375 MB.

#### If the fit stops working

Two levers, in the order worth trying.

Drop to one compile slot. `COMPILE_SERVICE_MAX_CONCURRENT_COMPILATIONS = "1"` gives
256 + 270 = **526 MB** on the bounds, or about 645 MB counting the parent's non-heap regions. The
cost is that a second concurrent request gets a 503 instead of a compile, which the client already
handles as backpressure.

Or take a larger machine, remembering that this moves both terms: the parent's share is a
percentage, so a 2 GB machine gives the parent 512 MB of heap and the ceiling becomes
512 + 540 = 1052 MB against 2048. That buys room for more slots rather than more headroom per slot.

Changing any of the child flags, or `MaxRAMPercentage` in the Dockerfile, means redoing the
arithmetic above. The child flags live in
`server/src/main/java/dev/jvmvisualizer/compileservice/compiler/ForkedCompiler.java`.

## Wiring the two together

Each side wants the other's URL, so deploy in this order and there is no chicken-and-egg:

1. Deploy the frontend with `VITE_COMPILE_API_URL` unset. You get the Vercel domain, and the site is
   already fully usable.
2. Set `COMPILE_SERVICE_ALLOWED_ORIGIN` in `server/fly.toml` to that domain and deploy the server.
   You get the Fly domain.
3. Set `VITE_COMPILE_API_URL` to the Fly domain in the Vercel project and redeploy. The editor tab
   appears as soon as the health check answers.

Two consequences worth knowing:

- Preview deployments get generated domains that will not match the allowed origin, so the editor
  stays hidden there. That is the designed degradation and not a fault: the service accepts one
  origin, and pointing previews at production would open the compiler to any preview URL.
- Attaching a custom domain later means updating `COMPILE_SERVICE_ALLOWED_ORIGIN` and redeploying
  the server, otherwise the editor disappears on the new domain while still working on the old one.

## Placeholders to fill in

Nothing here is deployed yet, so these are the values a first deploy has to supply.

| File                          | Placeholder                                                       | Replace with                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                   | _no demo link yet_                                                | A `> Live demo: <url>` line under the first screenshot, once there is a Vercel URL to point at.                                                                                                                                                                                                      |
| `README.md`                   | _no CI badges yet_                                                | Workflow badges, once the repository has a GitHub owner and name: `[![web](https://github.com/<owner>/<repo>/actions/workflows/web.yml/badge.svg)](…)`, and the same for `server`, `e2e`, `docs` and `codeql`. The repository has no git remote yet, so there is no owner or name to write.          |
| `web/index.html`              | `<meta property="og:image" content="/og-image.jpg" />`            | An absolute `https://<domain>/og-image.jpg`. The asset itself is done: `web/public/og-image.jpg` is a 1200x750 JPEG of about 135 KB, served from the deployment root and inside a budget the size check enforces. Only the domain is missing, and link previews do not resolve a root-relative path. |
| `server/fly.toml`             | `app = "CHANGE-ME-compile-service"`                               | The name reserved with `fly apps create`.                                                                                                                                                                                                                                                            |
| `server/fly.toml`             | `primary_region = "fra"`                                          | The region nearest your users.                                                                                                                                                                                                                                                                       |
| `server/fly.toml`             | `COMPILE_SERVICE_ALLOWED_ORIGIN = "https://CHANGE-ME.vercel.app"` | The exact frontend origin, no trailing slash.                                                                                                                                                                                                                                                        |
| Vercel project, env variables | `VITE_COMPILE_API_URL`                                            | `https://<your-fly-app>.fly.dev`. Only needed for the editor; leave it out and everything else still works.                                                                                                                                                                                          |

## Running the container locally

The same image the deploy builds, against a local frontend:

```bash
cd server
docker build -t compile-service .
docker run --rm -p 8080:8080 -e COMPILE_SERVICE_ALLOWED_ORIGIN=http://localhost:5173 compile-service
```

Then, from the repository root, `cp web/.env.example web/.env` and `npm run dev`: the editor tab
should appear, and a compilation should come back as a replayable program. This catches the two
failure modes that only show up in a container, a JRE base image and a repackaged jar, before they
reach Fly.
