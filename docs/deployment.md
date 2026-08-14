# Deployment

Two deployables that do not depend on each other. The editor tab appears only when a compile service
is configured and answers a health check, and nothing else in the application needs it. Neither
deploy is wired into CI.

| What                           | Where           | Built from                                  | Config                                  |
| ------------------------------ | --------------- | ------------------------------------------- | --------------------------------------- |
| `web/`: the visualizer         | Vercel (static) | `npm --workspace web run build`             | [`vercel.json`](../vercel.json)         |
| `server/`: the compile service | Fly.io          | [`server/Dockerfile`](../server/Dockerfile) | [`server/fly.toml`](../server/fly.toml) |

## Frontend on Vercel

1. Import the repository and leave **Root Directory** at the repository root, not `web/`. The build
   is a workspace command and needs the root `package.json` and `package-lock.json`.
2. Leave the build settings alone; `vercel.json` carries them. The one moving part is the CSP:
   `script-src` holds a sha256 of the inline theme script in `web/index.html`, so editing that
   script means recomputing the hash. `npm run csp -w web` compares the two and prints both values
   when they disagree; CI runs it in the `web` workflow.
3. Node version: 20 or 22. The root `package.json` requires `node >= 20.18.1`.
4. No environment variable is required. To light up the Java editor, add `VITE_COMPILE_API_URL` with
   the base URL of the compile service (`https://<your-fly-app>.fly.dev`), scheme and host only, no
   trailing slash and no path. Vite inlines it at build time, so a change only takes effect on the
   next deploy.
5. Deploy, then load the site: the bundled examples should replay, and dragging a `.class` file onto
   the window should load it.

## Backend on Fly.io

Prerequisites: [flyctl](https://fly.io/docs/flyctl/install/) and an account.

1. Reserve a name with `fly apps create your-compile-service`. App names are global, so pick
   something specific. Not `fly launch`: it rewrites `fly.toml` from its own detection and would
   discard the configuration in this repository.
2. Fill in [`server/fly.toml`](../server/fly.toml): the `app` name, the `primary_region` nearest
   your users (`fly platform regions` lists them) and `COMPILE_SERVICE_ALLOWED_ORIGIN`.

3. Deploy from `server/`, which is the build context the Dockerfile expects:

   ```bash
   cd server
   fly deploy
   ```

4. Verify:

   ```bash
   curl -fsS https://<your-app>.fly.dev/actuator/health
   # {"status":"UP"}

   curl -i -X POST https://<your-app>.fly.dev/api/compile \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://<your-vercel-domain>' \
     -d '{"source":"public class Foo { public static void main(String[] a) { int x = 1 + 1; } }"}'
   ```

   Expect `200` with `"success": true` and an `access-control-allow-origin` header. A missing CORS
   header means `COMPILE_SERVICE_ALLOWED_ORIGIN` does not match the browser's origin: scheme, host
   and port all have to be the same. A trailing slash is the one difference that does not matter.

### Environment

Set through `[env]` in `fly.toml`, or with `fly secrets set NAME=value`, which restarts the machine
on its own. Three need a decision:

| Variable                                      | Default                 | What it does                                                                                                                                                                                                                         |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPILE_SERVICE_ALLOWED_ORIGIN`              | `http://localhost:5173` | The one origin CORS allows, for `POST` and `OPTIONS` only. `*` is refused at start-up.                                                                                                                                               |
| `COMPILE_SERVICE_TRUST_FORWARDED_FOR`         | `false`                 | Whether `X-Forwarded-For` identifies the client for rate limiting. On behind Fly's proxy, off anywhere a client can forge it. `COMPILE_SERVICE_TRUSTED_PROXY_HOPS` (`1`) is how many entries from the right the client address sits. |
| `COMPILE_SERVICE_MAX_CONCURRENT_COMPILATIONS` | `2`                     | Compile slots, one child JVM each. Once they are all taken the service answers `503` with `Retry-After` instead of queueing.                                                                                                         |

`PORT` (`8080`) has to match `internal_port`, and the committed `fly.toml` sets both. The rate limit,
the size caps and the compile deadline are in `server/src/main/resources/application.yml`, reachable
from the environment through relaxed binding (`COMPILE_TIMEOUT`, `COMPILE_RATELIMIT_REQUESTSPERMINUTE`).

### Sizing and image requirements

- Memory. A compile slot is a child JVM budgeted at about 270 MB, and `-XX:MaxRAMPercentage=25` in
  the Dockerfile gives the parent a quarter of the machine, so the shipped 1 GB with two slots comes
  to 256 + 2 x 270 = 796 MB. The bounds behind those figures are commented in
  `ForkedCompiler.CHILD_VM_OPTIONS` and `server/fly.toml`. If the fit stops working, set
  `COMPILE_SERVICE_MAX_CONCURRENT_COMPILATIONS = "1"` before taking a larger machine, which raises
  the parent's share too, because it is a percentage.
- The image must be a JDK, since a JRE has no `jdk.compiler`, and the application must run exploded
  rather than as `java -jar app.jar`: a compilation is a child JVM launched with the parent's
  `java.class.path`, and inside a repackaged jar the application classes sit under `BOOT-INF`, where
  a plain `java -cp` cannot find them. The Dockerfile does both, and the service logs an error at
  start-up if it is ever packaged the other way.
- Cold starts. With `auto_stop_machines`, an idle machine stops and the next request pays a JVM
  start-up. The frontend gives the health check two seconds, so set `min_machines_running = 1` if
  the editor has to be there on the first visit.
- Base images are pinned by digest, so a rebuild does not pick up base-image security updates.
  `docker buildx imagetools inspect <tag>` resolves the current digest for the two `FROM` lines in
  `server/Dockerfile`.

## Wiring the two together

Each side wants the other's URL, so go in this order: deploy the frontend with
`VITE_COMPILE_API_URL` unset, set `COMPILE_SERVICE_ALLOWED_ORIGIN` in `server/fly.toml` to the
Vercel domain and deploy the server, then set `VITE_COMPILE_API_URL` to the Fly domain and redeploy
the frontend. Preview deployments get generated domains that will not match the allowed origin, so
the editor stays hidden there, and attaching a custom domain means updating
`COMPILE_SERVICE_ALLOWED_ORIGIN` and redeploying the server.

## Placeholders to fill in

These are the values a deploy has to supply. Everything else in this document works as committed.

| File                          | Placeholder                                                       | Replace with                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                   | _no demo link_                                                    | A `> Live demo: <url>` line under the first screenshot.                                                                                                                                                        |
| `README.md`                   | _no CI badges_                                                    | Workflow badges, once the repository has a GitHub owner and name: `[![web](https://github.com/<owner>/<repo>/actions/workflows/web.yml/badge.svg)](…)`, and the same for `server`, `e2e`, `docs` and `codeql`. |
| `web/index.html`              | `<meta property="og:image" content="/og-image.jpg" />`            | An absolute `https://<domain>/og-image.jpg`. Link previews do not resolve a root-relative path.                                                                                                                |
| `server/fly.toml`             | `app = "CHANGE-ME-compile-service"`                               | The name reserved with `fly apps create`.                                                                                                                                                                      |
| `server/fly.toml`             | `primary_region = "fra"`                                          | The region nearest your users.                                                                                                                                                                                 |
| `server/fly.toml`             | `COMPILE_SERVICE_ALLOWED_ORIGIN = "https://CHANGE-ME.vercel.app"` | The exact frontend origin, no trailing slash.                                                                                                                                                                  |
| Vercel project, env variables | `VITE_COMPILE_API_URL`                                            | `https://<your-fly-app>.fly.dev`. Only needed for the editor.                                                                                                                                                  |

## Running the container locally

The same image the deploy builds, against a local frontend:

```bash
cd server
docker build -t compile-service .
docker run --rm -p 8080:8080 -e COMPILE_SERVICE_ALLOWED_ORIGIN=http://localhost:5173 compile-service
```

Then, from the repository root, `cp web/.env.example web/.env` and `npm run dev`. This catches the
two failure modes that only show up in a container, a JRE base image and a repackaged jar.
