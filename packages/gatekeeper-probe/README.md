# Gatekeeper Probe

First-class [Probe](https://github.com/YunosukeYoshino/qa-agent) connector for Cloudflare OS.
Connect a Probe API from the Workshop UI and call typed methods from chat — no generic
`gatekeeper-mcp` grant paste, and no `MCP_ALLOW_INSECURE`.

Probe's MCP endpoint is loopback-only and grant-scoped. This gatekeeper talks to Probe's **HTTP
API** (`/api/health`, `/api/auth/*`, `/api/test-cases`, `/api/test-runs`) using a session the
connect form signs in with.

## Local development

1. Start Probe's API (default `http://127.0.0.1:8789`):

   ```bash
   pnpm dev:api   # in the Probe / qa-agent repo
   ```

2. Start Cloudflare OS from this repo:

   ```bash
   pnpm run-local
   ```

   `run-dev-server` discovers any `packages/gatekeeper-*/wrangler.jsonc`, so Probe is included
   automatically. Loopback HTTP is allowed here; this worker does **not** set
   `global_fetch_strictly_public`.

3. In the Workshop, **Connectors → Probe**. URL `http://127.0.0.1:8789`, email any address Probe
   should provision (local Probe uses fake identity; first sign-in creates the user).

4. Bind a resource:

   | Resource | Binding name | Session |
   | --- | --- | --- |
   | Workspace | `PROBE` | `ProbeWorkspaceSession` |
   | Test case | `PROBE_TEST_CASE` | `ProbeTestCaseSession` |
   | Run | `PROBE_RUN` | `ProbeRunSession` |

```ts
const cases = await env.PROBE.listTestCases();
const queued = await env.PROBE.startRun(cases[0].id);
if (queued.status === "pending") {
  const outcome = await env.PROBE.getActionResult(queued.actionId);
}
```

Reads (`getTestCase`, `listRuns`, `getRun`, `getMe`) return immediately. `startRun` waits for
confirmation; poll `getActionResult` for the queued run. Method names are camelCase
(`getTestCase`, not `get_test_case`).

## What this is not

- Not a wrapper around `/mcp/<grant-token>`. Grants, CSRF cookies from the Probe UI, and
  `MCP_ALLOW_INSECURE` are unused on this path.
- Not a production remote-Probe connector. Probe's own HTTP API is whatever you can reach from
  this worker (loopback when both run on the same machine). Exposing Probe beyond localhost is
  Probe's problem, not this package's.

## Build & test

```
pnpm exec vp run -F @gadgets/probe-gatekeeper build
pnpm --filter @gadgets/probe-gatekeeper test:run
```
