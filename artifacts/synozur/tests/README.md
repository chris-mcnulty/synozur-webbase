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
- **`polaris-linked-post.spec.ts`** — Backlog #212. Locks down the
  episode → blog post link card on `/polaris/:slug`. Asserts the card
  renders with the correct title and `/insights/:slug` href, that
  clicking it navigates to the insight detail page, and that an
  episode without a linked post renders no card. Data-driven against
  the public Polaris API rather than hard-coded slugs. **Content
  prerequisite:** the target environment must contain at least one
  published Polaris episode with a published linked post **and** at
  least one episode without one — both legs fail (rather than skip)
  if those aren't present, so coverage can't quietly disappear if seed
  data drifts.
- **`admin-solution-content.spec.ts`** — Backlog #193. Round-trip for
  the Solution admin form's Accelerators and FAQ rich-text editors
  (`data-testid="editor-solution-accelerators"` and
  `editor-solution-faq`, added in #188): signs in via the local
  password endpoint as `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, types
  unique markers into both editors, clicks `button-save-solution`, and
  asserts the markers render on the public `/solutions/:slug` page.
  Skipped when those env vars are unset.

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
