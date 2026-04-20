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

## Artifacts

- `artifacts/synozur` — React + Vite marketing site for **The Synozur Alliance** ("The Transformation Company"). Cosmic / North Star brand, violet `#810FFB` primary with a custom `nebula-gradient` utility defined in `src/index.css`. Routing via wouter under `BASE_URL` (mounted at `/`).
  - Pages: `/`, `/about`, `/services-overview/default`, `/services/:slug` (four pillars), `/clients`, `/case-studies`, `/case-studies/:slug`, `/applications`, `/applications/:slug` (Vega, Nebula, Constellation, Orion, Orbit, Zenith, Holidays & Birthdays Web Part), `/team`, `/partners`, `/insights`, `/polaris`, `/contact`, `/start`, plus a cosmic 404.
  - Application content lives in `src/data/applications.ts`; assets in `public/images/applications/` (downloaded from Wix CDN, resized).
  - Layout in `src/components/layout` (Header with nav dropdowns + mobile drawer, Footer with subscribe + columns).
  - Forms use `react-hook-form` + `zod`; submissions are simulated client-side (no backend).
  - SEO via `src/lib/meta.tsx` (sets `document.title` and meta description per page).
  - Initial prompt baseline saved at `.local/baselines/peanut-baseline.md`.
