# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Tools

- `tools/insights-crawler` — standalone, build-time crawler that mirrors the public Wix-hosted blog at `https://www.synozur.com/insights` into a typed JSON dataset for downstream DB ingest. Outputs to `tools/insights-crawler/output/`: `discovered.json`, `posts.json` (sorted by publishedAt desc, image URLs are local relative paths), `images/<slug>/...` (resized to ≤1920px wide), and `report.md`. Idempotent (HTML cache in `output/.cache/`, skips already-extracted posts unless `--force`). Runs locally only — does not run on the production server. Commands: `pnpm --filter @workspace/insights-crawler run discover` then `... run crawl` (or `run all`). See its README for details.

## Artifacts

- `artifacts/synozur` — React + Vite marketing site for **The Synozur Alliance** ("The Transformation Company"). Cosmic / North Star brand, violet `#810FFB` primary with a custom `nebula-gradient` utility defined in `src/index.css`. Routing via wouter under `BASE_URL` (mounted at `/`).
  - Pages: `/`, `/about`, `/services-overview/default`, `/services/:slug` (four pillars), `/clients`, `/case-studies`, `/case-studies/:slug`, `/applications`, `/applications/:slug` (Vega, Nebula, Constellation, Orion, Orbit, Zenith, Holidays & Birthdays Web Part), `/team`, `/partners`, `/insights`, `/polaris`, `/contact`, `/start`, plus a cosmic 404.
  - Application content lives in `src/data/applications.ts`; assets in `public/images/applications/` (downloaded from Wix CDN, resized).
  - Layout in `src/components/layout` (Header with nav dropdowns + mobile drawer, Footer with subscribe + columns).
  - Forms use `react-hook-form` + `zod` and POST to real backend endpoints under `/api/forms/*` (`submitContact`, `submitSubscribe`, `submitStart`). Server-side validation via generated Zod schemas, persistence in `form_submissions` table, optional webhook forwarding via `FORMS_WEBHOOK_URL`, honeypot field, and pluggable Cloudflare Turnstile via `TURNSTILE_SECRET_KEY` (active only when set).
  - SEO via `src/lib/meta.tsx` (per-page title, description, OG/Twitter, canonical). Global Organization JSON-LD via `src/components/organization-jsonld.tsx`.
  - Analytics + cookie consent via `src/components/analytics.tsx`. Reads `VITE_GA4_ID`, `VITE_LINKEDIN_PARTNER_ID` (defaults to `7337793`), `VITE_META_PIXEL_ID`. Marketing tags load only after consent (stored in `localStorage` under `synozur.cookieConsent.v1`).
  - Home "From The Feed" carousel data lives in `src/data/feed.ts`; carousel images in `public/images/home/feed/` (downloaded from Wix CDN, originals resized).
  - Initial prompt baseline saved at `.local/baselines/peanut-baseline.md`.
  - **Events system** (`/events`): Public Upcoming + Past listings backed by `GET /api/events`. Admin area at `/admin` (Clerk-auth'd, allow-listed via `ADMIN_EMAILS` env var) provides full CRUD over events with an Asset Library modal that uploads images via Uppy + Object Storage (`POST /api/storage/uploads/request-url`). Sign-in / sign-up at `/sign-in` and `/sign-up` (Clerk hosted components, dev keys via `VITE_CLERK_PUBLISHABLE_KEY`). Events are linked to assets through `events.image_asset_id`. Seeding script: `pnpm dlx tsx artifacts/api-server/src/scripts/seedEvents.ts` (reads `attached_assets/events_1776704614264.csv`).
