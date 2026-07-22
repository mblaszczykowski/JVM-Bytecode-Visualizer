# Deployment

There are two deployables and they do not depend on each other. The frontend is a static bundle —
the parser, the disassembler and the interpreter all run in the browser — and the compile service is
a container that turns Java source into class bytes for the optional editor. The application is
complete without the server: the bundled examples and `.class` upload cover the whole visualization
flow, and the editor tab only appears when a compile service is configured _and_ answers a health
check ([ADR-0004](adr/0004-backend-as-progressive-enhancement.md)).

So the frontend can go live on its own, and the backend can be added, restarted or removed later
without touching it.

| What                            | Where           | Built from                                  | Config                                  |
| ------------------------------- | --------------- | ------------------------------------------- | --------------------------------------- |
| `web/` — the visualizer         | Vercel (static) | `npm --workspace web run build`             | [`vercel.json`](../vercel.json)         |
| `server/` — the compile service | Fly.io          | [`server/Dockerfile`](../server/Dockerfile) | [`server/fly.toml`](../server/fly.toml) |

Neither deploy is wired into CI. `.github/workflows/` runs lint, tests and the Playwright suite; the
deploys are a Vercel git integration and a `fly deploy` you run yourself.

## The frontend on Vercel

1. **Import the repository** in Vercel and leave **Root Directory** at the repository root — not
   `web/`. The build is a workspace command and needs the root `package.json` and
   `package-lock.json`.
2. **Leave the build settings alone.** `vercel.json` supplies them:
   - `installCommand: npm ci` — a deterministic install of every workspace from the committed
     lockfile.
   - `buildCommand: npm --workspace web run build` — the same `tsc -b && vite build` that CI runs,
     so a type error fails the deploy rather than shipping.
   - `outputDirectory: web/dist`.
   - `framework: null` — the build is stated explicitly. Framework detection would look for a Vite
     project at the root of the repository, where there is only a workspace manifest.
   - The `rewrites` entry is the single-page-app fallback. Vercel checks the filesystem before
     rewrites, so real files still win; only a path with nothing behind it falls back to
     `index.html`, which is what a client-side route needs — including the shareable links on the
     roadmap.
   - The `headers` entry marks `/assets/*` immutable. Those filenames are content-hashed by Vite.
     `public/examples/` is deliberately left on the default caching, because those filenames are
     stable and their contents can be regenerated.
3. **Node version:** 20 or 22. The root `package.json` requires `node >= 20.18.1`.
4. **Environment variables:** none are required. To light up the Java editor, add
   `VITE_COMPILE_API_URL` with the base URL of the compile service — scheme and host only, no
   trailing slash and no path:

   ```
   VITE_COMPILE_API_URL = https://<your-fly-app>.fly.dev
   ```

   Vite inlines this at build time, so a change only takes effect on the next deploy. Unset, the
   editor tab does not exist and nothing else changes.

5. **Deploy**, then load the site: the four examples should replay, and dragging a `.class` file
   onto the window should load it.

## The backend on Fly.io

Prerequisites: [flyctl](https://fly.io/docs/flyctl/install/) and an account.

1. **Reserve a name.** App names are global, so pick something specific:

   ```bash
   fly apps create your-compile-service
   ```

   Avoid `fly launch` here — it rewrites `fly.toml` from its own detection and would discard the
   configuration in this repository.

2. **Fill in [`server/fly.toml`](../server/fly.toml):** the `app` name, the `primary_region` nearest
   your users (`fly platform regions` lists them) and `COMPILE_SERVICE_ALLOWED_ORIGIN`.

3. **Deploy from `server/`:**

   ```bash
   cd server
   fly deploy
   ```

   The build context is `server/`, which is what the Dockerfile expects; `server/.dockerignore`
   keeps `target/` and the Maven wrapper out of it.

4. **Verify:**

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
   not match the browser's origin exactly — scheme, host and port all count, and a trailing slash
   breaks the match.

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
needs to differ — `COMPILE_TIMEOUT`, `COMPILE_RATELIMIT_REQUESTSPERMINUTE`.

### Sizing, and what the image has to keep doing

- **Memory.** The parent JVM takes at most half the machine (`-XX:MaxRAMPercentage=50`); the rest is
  for compiler processes, each capped at 128 MB of heap plus its own overhead. 1 GB with two slots
  is comfortable. Dropping to 512 MB means dropping to one slot.
- **The runtime is a JDK, not a JRE.** The service compiles Java on demand, and without the
  `jdk.compiler` module there is no compiler to run. The Dockerfile already uses a JDK image; keep
  it that way.
- **The application runs exploded, not as `java -jar app.jar`.** A compilation happens in a child
  JVM launched with the parent's `java.class.path`, and inside a repackaged Spring Boot jar the
  application classes sit under `BOOT-INF`, where a plain `java -cp` cannot find them. The
  Dockerfile unpacks the jar for exactly this reason, and the service logs an error at start-up if
  it ever finds itself packaged the other way.
- **Cold starts.** With `auto_stop_machines`, a machine that has been idle stops, and the first
  request afterwards pays a JVM start-up. The frontend gives the health check two seconds before it
  decides the service is not there, so after a stop the editor may be missing on the first visit and
  present on the second. Set `min_machines_running = 1` if that matters more than the idle cost.

## Wiring the two together

Each side wants the other's URL, so deploy in this order and there is no chicken-and-egg:

1. **Deploy the frontend** with `VITE_COMPILE_API_URL` unset. You get the Vercel domain, and the
   site is already fully usable.
2. **Set `COMPILE_SERVICE_ALLOWED_ORIGIN`** in `server/fly.toml` to that domain and deploy the
   server. You get the Fly domain.
3. **Set `VITE_COMPILE_API_URL`** to the Fly domain in the Vercel project and redeploy. The editor
   tab appears as soon as the health check answers.

Two consequences worth knowing:

- **Preview deployments get generated domains** that will not match the allowed origin, so the
  editor stays hidden there. That is the designed degradation rather than a fault — the service
  accepts one origin, and pointing previews at production would open the compiler to any preview URL.
- **Attaching a custom domain later** means updating `COMPILE_SERVICE_ALLOWED_ORIGIN` and
  redeploying the server, otherwise the editor disappears on the new domain while still working on
  the old one.

## Placeholders to fill in

| File                          | Placeholder                                                             | Replace with                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` (three badges)    | `OWNER/REPO`                                                            | The GitHub owner and repository name, so the workflow badges point at real runs.                                                                                                        |
| `README.md`                   | `> Live demo: _coming soon_`                                            | The Vercel URL.                                                                                                                                                                         |
| `web/index.html`              | `<meta property="og:image" content="docs/screenshots/app-ready.png" />` | An absolute `https://<domain>/…` URL. Link previews do not resolve relative paths, and the image has to be served by the deployment — put a copy under `web/public/` and point at that. |
| `server/fly.toml`             | `app = "CHANGE-ME-compile-service"`                                     | The name reserved with `fly apps create`.                                                                                                                                               |
| `server/fly.toml`             | `primary_region = "fra"`                                                | The region nearest your users.                                                                                                                                                          |
| `server/fly.toml`             | `COMPILE_SERVICE_ALLOWED_ORIGIN = "https://CHANGE-ME.vercel.app"`       | The exact frontend origin, no trailing slash.                                                                                                                                           |
| Vercel project, env variables | `VITE_COMPILE_API_URL`                                                  | `https://<your-fly-app>.fly.dev`. Only needed for the editor; leave it out and everything else still works.                                                                             |

## Rehearsing the container locally

The same image the deploy builds, against a local frontend:

```bash
cd server
docker build -t compile-service .
docker run --rm -p 8080:8080 -e COMPILE_SERVICE_ALLOWED_ORIGIN=http://localhost:5173 compile-service
```

Then, from the repository root, `cp web/.env.example web/.env` and `npm run dev`: the editor tab
should appear, and a
compilation should come back as a replayable program. This catches the two failure modes that only
show up in a container — a JRE base image and a repackaged jar — before they reach Fly.
