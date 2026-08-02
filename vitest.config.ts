/**
 * The repository root has no test suite. This file exists to say so out loud.
 *
 * Everything lives in the `web` workspace, whose config defines two projects with two
 * different environments (`core` on Node, `ui` on jsdom) — see `web/vite.config.ts`. Vitest
 * does not support referencing those from here, because a project may not itself contain
 * projects.
 *
 * Without this file a bare `vitest` typed at the root falls back to Vitest's defaults, and
 * those collect `web/tests/e2e/*.spec.ts` — Playwright specs, which throw on import — and run
 * the jsdom suite under Node, where everything touching the DOM fails with
 * `document is not defined`. Several hundred failures, not one of them real, from a command
 * that looks exactly right. Failing immediately with the command that does work is the kinder
 * of the two answers.
 */
throw new Error(
  'There is no test suite at the repository root. Run the web workspace suite instead:\n' +
    '  npm test              (from anywhere in the repository)\n' +
    '  npx vitest            (from ./web)\n',
);
