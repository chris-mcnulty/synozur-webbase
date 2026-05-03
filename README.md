# Synozur Alliance — Web Base

Monorepo for the public marketing site (`synozur.com`), the api-server, the
Galaxy client portal, and supporting tooling.

## Status

[![Quality (Lighthouse CI)](https://github.com/chris-mcnulty/Synozur-WebBase/actions/workflows/quality.yml/badge.svg?branch=main&event=push)](https://github.com/chris-mcnulty/Synozur-WebBase/actions/workflows/quality.yml?query=branch%3Amain)

The badge reflects the latest status of the `quality.yml` workflow on
`main` — that workflow contains the PR-blocking **Lighthouse CI** job
(GitHub does not currently support per-job badges). Click through to the
most recent run to see the dedicated Lighthouse CI job result. The full
HTML report for any given run is attached as the `lighthouse-report`
workflow artifact, and same-repo PRs receive a sticky comment summarizing
per-route pass/fail.

## Layout

See [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) and the `artifacts/` and
`lib/` directories. Day-to-day conventions live in the workspace skill at
`.local/skills/pnpm-workspace`.

## Common commands

- `pnpm install` — install workspace dependencies
- `pnpm run typecheck` — full typecheck across libs and leaf packages
- `pnpm run lhci` — run Lighthouse CI locally against a running preview at
  `http://localhost:5000`
