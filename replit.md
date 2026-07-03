# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for **The Synozur Alliance**, a "Transformation Company." It features a React + Vite marketing site, a comprehensive CMS backend, and integrations for CRM, analytics, and authentication.

The primary goal is to provide a robust platform for managing content, engaging with users, and supporting business operations, including client organizations and event management. The project emphasizes scalability, maintainability, and a structured development approach with a focus on a seamless user experience and secure data handling.

# Admin Guide

The platform admin guide is maintained at [`admin-guide.md`](admin-guide.md). It covers all admin UI areas, authentication, content types, integrations, environment variables, and maintenance instructions for agents. Read it before making changes to the CMS, admin routes, site settings, or integrations.

# User Preferences

I want iterative development.
I want to be asked before you make any major changes.
I do not want you to change any files in the `docs/` directory.

## Standing Actions on PR / Task-Agent Merges

When any external PR or task-agent branch is merged, always:
1. Inspect `lib/db/src/schema/*.ts` for added/removed columns and verify the DB matches (no phantom columns, no missing ones).
2. Check `artifacts/api-server/src/lib/migrations.ts` for new steps and confirm they ran (`information_schema.columns` or a targeted SQL probe).
3. Scan for new scripts in `artifacts/api-server/src/scripts/` — document whether they need a one-time run and record the outcome.
4. Verify new routes are registered in `routes/index.ts` and new admin pages are wired into `App.tsx` + `AdminLayout.tsx`.
5. Check `lib/api-zod/src/` for any hand-written schemas that must stay in sync with `openapi.yaml` (e.g. `experiments.ts` ConversionPath kinds).
6. Probe the dev DB for data-integrity issues (orphaned rows, null discriminators that new code depends on).
7. Add a migration step for any data gap found, then restart the API server to apply it.

# System Architecture

## UI/UX Decisions

The marketing site (`artifacts/synozur`) uses React and Vite. It features a cosmic brand identity with a violet primary color (`#810FFB`) and a `nebula-gradient` utility. Navigation includes a Header with dropdowns and a mobile drawer, and a Footer with subscription and column layouts. SEO is handled via per-page metadata, OG/Twitter tags, canonical URLs, and global Organization JSON-LD. Analytics and cookie consent are integrated, loading marketing tags only after user consent.

## Technical Implementations

The project is a monorepo managed by pnpm workspaces. It uses Node.js 24, TypeScript 5.9, Express 5 for the API, PostgreSQL with Drizzle ORM, and Zod for validation. API codegen is done with Orval from an OpenAPI spec, and builds use esbuild.

Key features include:
- **Transactional Email**: Uses Resend for branded confirmation emails and internal notifications on form submissions, with fire-and-forget sending and robust error logging.
- **Forms**: Built with `react-hook-form` and `zod`, posting to backend endpoints with server-side validation, persistence, optional webhook forwarding, honeypot fields, and Cloudflare Turnstile integration.
- **Insights Comments**: Public discussion section under blog posts, supporting threaded comments, rate-limiting, and moderation.
- **Team System**: Public team grid with admin CRUD interface, active toggles, sort keys, tags, and rich descriptions. Photos are static files.
- **Events System**: Public listings for upcoming and past events. Admin area for CRUD operations, including an asset library for image uploads to object storage.
- **Authentication**: Multi-method authentication supporting Entra SSO (OIDC with group reconciliation for Synozur's tenant and client orgs, multi-environment redirect URIs) and local email/password (bcrypt-hashed, email verification, password reset). Roles include `admin`, `editor`, `author`, `contributor`, and `client`. Sessions are server-side and revocable.
- **Client Organizations**: Manages access to the portal, allowing for `entraTenantId` and `approvedEmailDomains` for auto-join, and assigning default roles. Provides admin UI and API for management.
- **Entra Group to Role Mappings**: Allows mapping Entra groups to specific roles, scoped by client organization or globally for Synozur-internal.
- **Insights CMS Backend**: Express 5 API server providing CRUD operations for posts, categories, tags, media, comments, and users. Features role-based authorization, a scheduler for publishing posts, and an audit log for all mutations.
- **Database Schema**: Drizzle ORM defines schemas for `users`, `roles`, `posts`, `categories`, `tags`, `media`, `comments`, `audit_log`, and client organization-related tables.
- **Solutions Taxonomy** (post-Board, May 2026): `solutions.solution_group` enum (`ai_strategy` | `gtm` | `company_os` | `consulting_services`) plus a `showInMenu` boolean drive the public Services menu and footer (via `api.listSolutions({showInMenu:true})` and `buildSolutionsMenuGroup` in `lib/synozur-nav`). The legacy `pillar` column has been dropped. `parent_service_id` is retained as an admin-only editorial tag and is not surfaced publicly. Tagline + values copy lead with "Transformation with momentum — AI-native, human-centered", the North Star Method™ (Assess · Define · Deliver · Outcomes), and a Critical Thinking & AI Guardrails value.
- **Solution Highlights** (Task #317, May 2026): Per-solution rotating callouts. The `solution_highlights` join table (`solution_id` × `collateral_id`, ordered, with `active` toggle) lets admins pin any Collateral item to a solution; `getSolutionWithCapabilities` joins them server-side into `highlights[]` on the `SolutionDetail` response. The public `/solutions/:slug` page picks one at random per page load and renders it in place of the legacy hard-coded Zenith block — falling back to `acceleratorsHtml` when no highlights are attached. Admin UI lives in the solution edit page; replace-all via `PUT /api/cms/solutions/:id/highlights` (audit action `solution.highlights.replace`). Editing the linked `collateral` row auto-updates copy everywhere it's pinned.
- **API Specification**: OpenAPI is the source of truth, generating Zod schemas (`lib/api-zod`) and React Query hooks/types (`lib/api-client-react`).

## Feature Specifications

- **Deployment Policy**: **www.synozur.com is live and pointing at this Replit deployment** (synozur-baseline.replit.app). Production has its own separate read-write PostgreSQL database — it is NOT a periodic copy of development. Dev and prod databases are independent; schema migrations and data changes must be applied to each environment separately. The production database is the source of truth for live data.
- **Insights Crawler**: A standalone, build-time crawler (`tools/insights-crawler`) mirrors the public Wix-hosted blog into a typed JSON dataset for database ingestion. It's idempotent and outputs discovered posts, sorted posts with local image paths, resized images, and a report.
- **Galaxy Customer Portal** (`artifacts/galaxy`, mounted at `/galaxy/`): v0 customer-facing portal that shares the api-server session cookie (`sid`) with the Synozur SPA. Authenticated customers (role `customer` + linked, active `clientOrganization`) see a greeting, account team card (account manager + primary contacts via `client_organization_users`), and active engagements (`engagements` table). Backed by the `Portal` tag in the OpenAPI spec (`/portal/me`, `/portal/engagements`) and gated by `requireCustomerAudience` middleware which returns structured 403 reasons (`not_a_customer`, `no_organization`, `organization_inactive`).
- **HubSpot Integration**: Successful form submissions are enqueued and processed by an in-process worker to upsert Contacts and emit custom timeline events in HubSpot. This ensures resilience against HubSpot outages and includes retry mechanisms. Token resolution uses Replit Connections or a static environment variable. Supports GDPR erasure and first-touch attribution.

# Reference Repositories

- **SCDP (Constellation)**: https://github.com/chris-mcnulty/synozur-scdp — the Synozur internal project management platform. Use this as the design and colour reference for the Aurora theme and any admin UI work.

# External Dependencies

- **Database**: PostgreSQL (via Drizzle ORM)
- **Email Service**: Resend (for transactional emails)
- **CRM**: HubSpot (for form submission syncing)
- **Identity Provider**: Microsoft Entra ID (for SSO authentication)
- **Object Storage**: Replit App Storage (for media uploads)
- **Analytics**: Google Analytics 4 (GA4), LinkedIn Partner ID, Meta Pixel
- **Captcha**: Cloudflare Turnstile (for form spam protection)
- **Content Source**: Wix (for blog content mirrored by the Insights Crawler)