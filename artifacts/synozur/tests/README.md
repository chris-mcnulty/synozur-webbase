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
- **`polaris-collateral-sync.spec.ts`** — Backlog #185. Drives the
  Polaris episode editor's Collateral Library card end-to-end:
  navigates as an admin to
  `/admin/library/polaris-episodes/:id/edit`, clicks
  "Add to library", asserts the card flips to the synced state, then
  clicks "Sync to library" and asserts the re-sync toast. Skipped
  automatically when `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` are
  unset.
- **`sign-in.spec.ts`** — Clerk-removal cleanup #9. Smokes the
  `/sign-in` page render and (when Entra is configured) the OIDC
  redirect; the full Entra round-trip is gated on
  `E2E_ENTRA_TEST_USER_EMAIL` / `E2E_ENTRA_TEST_USER_PASSWORD`.
- **`sign-in-flow.spec.ts`** — Task #119. End-to-end coverage of the
  local-auth happy path (register → verify email → sign in →
  `/admin` → sign out), the wrong-password error banner, and the
  `?returnTo=/admin/insights/posts` deep-link redirect. Each test
  creates a brand-new randomized user via `POST /api/auth/register`,
  consumes its verification token from the `email_verification_tokens`
  table directly (so it doesn't depend on a real mailbox), grants the
  `admin` role so `/admin` renders, and deletes the user in `finally`.
  Requires `DATABASE_URL` to be set in the test runner environment.

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

### Reaching `/api/*` from the SPA host

In production the platform reverse proxy fronts both the SPA and the
API server on a single domain (`/api/*` → api-server, everything else
→ SPA). When you run `vite dev` or `vite preview` directly there is no
such proxy, so the SPA's runtime API calls and the
`polaris-collateral-sync.spec.ts` admin setup will hit the SPA host
and 404. Set `E2E_API_PROXY_TARGET=http://localhost:8000` (the
api-server's port) before starting `vite dev` / `vite preview` and the
config in `vite.config.ts` will wire `/api`, `/.well-known`, and
`/oauth` through to the API server. Pointing tests at the Replit dev
domain or a published staging URL via `E2E_BASE_URL` makes this
unnecessary because those origins already route `/api/*` server-side.

### Polaris collateral sync test (`#185`)

`polaris-collateral-sync.spec.ts` exercises an authenticated admin
flow, so it gates on:

- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` — credentials for a user
  with a verified email and an `admin` or `editor` role grant on the
  target stack. The local-password sign-in path requires
  `emailVerified=true`, so a freshly seeded user without email
  verification will not work.
- The target stack must serve `/api/*` from the same origin the test
  hits (see "Reaching /api/\* from the SPA host" above).

When the env vars are unset the suite self-skips, matching the
gating pattern used by `sign-in.spec.ts`.

## CI

`.github/workflows/quality.yml` runs typecheck + build on every push
and pull request automatically. The Playwright + Lighthouse jobs are
parked behind `workflow_dispatch` until the team wires up either an
ephemeral Postgres + seed step in the runner or points the workflow at
a stable staging URL via `E2E_BASE_URL`. The dispatch job already
sets `E2E_API_PROXY_TARGET` and forwards the
`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` repo secrets to the
Playwright step so the polaris collateral sync test runs as soon as
those secrets are configured.
