# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for **The Synozur Alliance**, a "Transformation Company." It features a React + Vite marketing site, a comprehensive CMS backend, and integrations for CRM, analytics, and authentication.

The primary goal is to provide a robust platform for managing content, engaging with users, and supporting business operations, including client organizations and event management. The project emphasizes scalability, maintainability, and a structured development approach with a focus on a seamless user experience and secure data handling.

# User Preferences

I want iterative development.
I want to be asked before you make any major changes.
I do not want you to change any files in the `docs/` directory.

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
- **API Specification**: OpenAPI is the source of truth, generating Zod schemas (`lib/api-zod`) and React Query hooks/types (`lib/api-client-react`).

## Feature Specifications

- **Deployment Policy**: Pre-release mode with development (Replit) as the primary content entry point. Production is a read-only preview, kept in sync by periodically re-syncing the development database.
- **Insights Crawler**: A standalone, build-time crawler (`tools/insights-crawler`) mirrors the public Wix-hosted blog into a typed JSON dataset for database ingestion. It's idempotent and outputs discovered posts, sorted posts with local image paths, resized images, and a report.
- **HubSpot Integration**: Successful form submissions are enqueued and processed by an in-process worker to upsert Contacts and emit custom timeline events in HubSpot. This ensures resilience against HubSpot outages and includes retry mechanisms. Token resolution uses Replit Connections or a static environment variable. Supports GDPR erasure and first-touch attribution.

# External Dependencies

- **Database**: PostgreSQL (via Drizzle ORM)
- **Email Service**: Resend (for transactional emails)
- **CRM**: HubSpot (for form submission syncing)
- **Identity Provider**: Microsoft Entra ID (for SSO authentication)
- **Object Storage**: Replit App Storage (for media uploads)
- **Analytics**: Google Analytics 4 (GA4), LinkedIn Partner ID, Meta Pixel
- **Captcha**: Cloudflare Turnstile (for form spam protection)
- **Content Source**: Wix (for blog content mirrored by the Insights Crawler)