# Synozur web tests

End-to-end + accessibility harness for the public marketing site.

## What's covered

- **`services.spec.ts`** — Backlog #57. Walks home → Services nav →
  services overview → a service detail → a solution detail. Assertions
  are structural (link contracts), not editorial.
- **`a11y.spec.ts`** — Backlog #142 Phase C. Runs `@axe-core/playwright`
  against six representative public routes. Fails the run on any
  `serious`+ WCAG 2.2 AA violation; less-severe findings surface as
  test annotations.

The publish gate that consumes these signals lives in #142 Phase D.

## Local invocation

The harness assumes a real backend is running. Bring up the full dev
stack first:

```sh
# in one terminal
PORT=8000 pnpm --filter @workspace/api-server dev

# in another
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/synozur dev
```

Then install the Playwright browser binaries (one-time per machine) and
run the suite:

```sh
pnpm --filter @workspace/synozur exec playwright install chromium
pnpm --filter @workspace/synozur test:e2e
```

By default tests hit `http://localhost:5000`. Override with
`E2E_BASE_URL=https://staging.synozur.com pnpm test:e2e` to run against
a deployed environment.

## CI

`.github/workflows/quality.yml` runs typecheck + build on every push
and pull request automatically. The Playwright + Lighthouse jobs are
parked behind `workflow_dispatch` until the team wires up either an
ephemeral Postgres + seed step in the runner or points the workflow at
a stable staging URL via `E2E_BASE_URL`.
