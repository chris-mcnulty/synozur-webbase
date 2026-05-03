import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotent schema migrations that run on every server startup.
 *
 * All statements use IF NOT EXISTS / DO NOTHING guards so they are safe to
 * re-run against a database that is already up to date. Add new migrations
 * at the end; do not remove old ones.
 *
 * This supplements drizzle-kit push (which is run against the dev database
 * during post-merge) and ensures the production database stays in sync when
 * the server restarts after a deployment.
 */
export async function runMigrations(): Promise<void> {
  logger.info("Running startup migrations");

  try {
    // #126 / #131 — PR 45: Entra SSO + HubSpot lead capture
    // -----------------------------------------------------------

    // 1. users: rename clerk_user_id → external_subject if the old column still exists.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'clerk_user_id'
        ) THEN
          ALTER TABLE users RENAME COLUMN clerk_user_id TO external_subject;
          ALTER TABLE users ALTER COLUMN external_subject DROP NOT NULL;
        END IF;
      END $$;
    `);

    // 2. users: new columns. (Note: `last_sso_provider` was historically added
    //    here but dropped in step 38 — `auth_provider` is the canonical signal.)
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS auth_provider text,
        ADD COLUMN IF NOT EXISTS entra_tenant_id text,
        ADD COLUMN IF NOT EXISTS entra_object_id text,
        ADD COLUMN IF NOT EXISTS entra_group_claims jsonb,
        ADD COLUMN IF NOT EXISTS entra_groups_refreshed_at timestamptz,
        ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS marketing_opt_in_updated_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
    `);

    // 3. users: swap index (idempotent — drop old name, create new).
    await db.execute(sql`DROP INDEX IF EXISTS users_clerk_user_id_key;`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS users_external_subject_key
        ON users (auth_provider, external_subject)
        WHERE external_subject IS NOT NULL AND auth_provider IS NOT NULL;
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_entra_object_id_idx ON users (entra_object_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`);

    // 4. sessions table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        user_agent text,
        ip text
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);`);

    // 5. auth_pending_states table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS auth_pending_states (
        state text PRIMARY KEY,
        code_verifier text NOT NULL,
        nonce text NOT NULL,
        return_to text,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS auth_pending_states_expires_at_idx ON auth_pending_states (expires_at);`);

    // 6. entra_group_role_mappings table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS entra_group_role_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entra_group_id text NOT NULL,
        entra_group_name text,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS entra_group_role_synozur_unique_v0
        ON entra_group_role_mappings (entra_group_id, role_id);
    `);

    // 7. hubspot_sync_events table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hubspot_sync_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL,
        contact_email text,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        hubspot_resource_id text,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        succeeded_at timestamptz
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS hubspot_sync_status_idx ON hubspot_sync_events (status, next_attempt_at);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS hubspot_sync_email_idx ON hubspot_sync_events (contact_email);`);

    // 8. site_settings: HubSpot + Entra columns.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS hubspot_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS hubspot_timeline_app_id text,
        ADD COLUMN IF NOT EXISTS hubspot_eu_opt_in_default boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS hubspot_form_toggles jsonb,
        ADD COLUMN IF NOT EXISTS hubspot_lifecycle_mappings jsonb,
        ADD COLUMN IF NOT EXISTS entra_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS entra_tenant_id text,
        ADD COLUMN IF NOT EXISTS entra_admin_group_fallback text;
    `);

    // 8b. #133 — Constellation interactive demo kill-switch column. Defaults
    // to enabled so existing deployments stay on; admins flip from the
    // site-settings admin without a redeploy.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS constellation_demo_enabled boolean NOT NULL DEFAULT true;
    `);

    // 8c. #133 — application_demo_completions: anonymous demo completions
    // queued for HubSpot timeline sync once the visitor self-identifies via
    // a form submission carrying the same `syn_visitor` cookie.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS application_demo_completions (
        id serial PRIMARY KEY,
        app text NOT NULL,
        visitor_id text NOT NULL,
        step text,
        path text,
        payload jsonb,
        completion_id text,
        completed_at timestamptz NOT NULL DEFAULT now(),
        synced_at timestamptz
      );
    `);
    await db.execute(sql`
      ALTER TABLE application_demo_completions
        ADD COLUMN IF NOT EXISTS completion_id text;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS application_demo_completions_visitor_idx
        ON application_demo_completions (visitor_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS application_demo_completions_pending_idx
        ON application_demo_completions (synced_at);
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS application_demo_completions_completion_id_uidx
        ON application_demo_completions (completion_id);
    `);

    // 9. form_submissions: attribution + HubSpot sync columns.
    await db.execute(sql`
      ALTER TABLE form_submissions
        ADD COLUMN IF NOT EXISTS marketing_opt_in boolean,
        ADD COLUMN IF NOT EXISTS utm_source text,
        ADD COLUMN IF NOT EXISTS utm_medium text,
        ADD COLUMN IF NOT EXISTS utm_campaign text,
        ADD COLUMN IF NOT EXISTS utm_term text,
        ADD COLUMN IF NOT EXISTS utm_content text,
        ADD COLUMN IF NOT EXISTS landing_page text,
        ADD COLUMN IF NOT EXISTS referrer text,
        ADD COLUMN IF NOT EXISTS hubspot_contact_id text,
        ADD COLUMN IF NOT EXISTS hubspot_sync_status text,
        ADD COLUMN IF NOT EXISTS hubspot_sync_error text;
    `);

    // 10. Multi-environment + multi-tenant + local auth additions
    // -------------------------------------------------------

    // 10a. auth_pending_states: store the redirect_uri used in the authorize
    //      request so the callback token-exchange always echoes back the exact
    //      same URI. This is required by OIDC spec and also means both the dev
    //      (Replit preview domain) and prod (custom domain) work with one
    //      deployment — no AUTH_REDIRECT_URI env var required.
    await db.execute(sql`
      ALTER TABLE auth_pending_states
        ADD COLUMN IF NOT EXISTS redirect_uri text;
    `);

    // 10b. client_organizations: external entities whose members get portal
    //      access. Supports Entra SSO (via entraTenantId), email/password
    //      registrants (via approved domains or admin assignment), and future
    //      OAuth-linked accounts — all under one org record.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS client_organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL,
        entra_tenant_id text,
        entra_tenant_name text,
        approved_email_domains text[],
        is_active boolean NOT NULL DEFAULT true,
        default_role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS client_orgs_slug_key ON client_organizations (slug);`);
    // Partial unique index so NULLs don't compete but one org per Entra tenant is enforced.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS client_orgs_entra_tenant_key
        ON client_organizations (entra_tenant_id)
        WHERE entra_tenant_id IS NOT NULL;
    `);

    // 10c. users: local password hash for email/password registration and
    //      FK to the owning client organization.
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_hash text,
        ADD COLUMN IF NOT EXISTS client_organization_id uuid REFERENCES client_organizations(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_client_org_idx ON users (client_organization_id);`);

    // 10d. entra_group_role_mappings: add client_organization_id FK so mappings
    //      can be scoped to a client org's directory (NULL = Synozur-internal).
    //      Replace the old broad unique index with two partial ones.
    await db.execute(sql`
      ALTER TABLE entra_group_role_mappings
        ADD COLUMN IF NOT EXISTS client_organization_id uuid REFERENCES client_organizations(id) ON DELETE CASCADE;
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS entra_group_role_org_idx ON entra_group_role_mappings (client_organization_id);`);
    // Drop old unique index that didn't account for org scope, replace with partial variants.
    await db.execute(sql`DROP INDEX IF EXISTS entra_group_role_unique;`);
    await db.execute(sql`DROP INDEX IF EXISTS entra_group_role_synozur_unique_v0;`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS entra_group_role_synozur_unique
        ON entra_group_role_mappings (entra_group_id, role_id)
        WHERE client_organization_id IS NULL;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS entra_group_role_client_unique
        ON entra_group_role_mappings (entra_group_id, role_id, client_organization_id)
        WHERE client_organization_id IS NOT NULL;
    `);

    // 10e. Ensure all canonical roles exist, including the new "client" role.
    await db.execute(sql`
      INSERT INTO roles (id, name, description)
      VALUES (gen_random_uuid(), 'client', 'Portal access for approved client organization members')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 11. Email verification + password reset flows
    // -------------------------------------------------------

    // 11a. users: add email_verified column (local registrants only; SSO users
    //      are implicitly verified by the IdP).
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
    `);

    // 11b. email_verification_tokens: single-use 24-hour tokens sent to new
    //      local registrants. Consumed (usedAt set) when the user clicks the
    //      link; the row is also cleaned up by expiry sweeps.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);`);

    // 11c. password_reset_tokens: single-use 1-hour tokens for the
    //      forgot-password / reset-password flow. All tokens for a user are
    //      purged on successful reset so old links are immediately dead.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);`);

    // 12. site_settings: add site_theme column for admin-selectable themes.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS site_theme text NOT NULL DEFAULT 'cosmic';
    `);

    // 15. workshops — PR 51: DB-backed workshops replacing static data file.
    //     Stores all content as JSONB blobs; FKs to services/solutions for
    //     the "related workshops" rail. active+deletedAt govern visibility
    //     (no status/publishedAt parity yet — see backlog).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workshops (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL,
        title text NOT NULL,
        category text NOT NULL DEFAULT '',
        short_description text NOT NULL DEFAULT '',
        hero_headline text NOT NULL DEFAULT '',
        hero_subhead text NOT NULL DEFAULT '',
        hero_image text NOT NULL DEFAULT '',
        hero_trust_bullets jsonb NOT NULL DEFAULT '[]',
        primary_cta jsonb NOT NULL DEFAULT '{"label":"","href":""}',
        secondary_cta jsonb,
        delivery_format text NOT NULL DEFAULT '',
        duration text NOT NULL DEFAULT '',
        who_its_for jsonb NOT NULL DEFAULT '[]',
        ideal_participants jsonb NOT NULL DEFAULT '[]',
        prerequisites jsonb NOT NULL DEFAULT '[]',
        pain jsonb NOT NULL DEFAULT '{"header":"","lead":"","tiles":[]}',
        scope jsonb NOT NULL DEFAULT '{"header":"","summary":"","bullets":[],"included":[]}',
        process jsonb NOT NULL DEFAULT '{"header":"","steps":[]}',
        deliverables jsonb NOT NULL DEFAULT '{"header":"","core":[],"executive":[],"enablement":[],"addOns":[]}',
        price jsonb NOT NULL DEFAULT '{"label":"","display":"","timeline":"","whatIsIncluded":[]}',
        diagnostic jsonb,
        competitive_intel jsonb,
        tooling_note text,
        outcomes jsonb NOT NULL DEFAULT '{"header":"","bullets":[]}',
        before_example text NOT NULL DEFAULT '',
        after_example text NOT NULL DEFAULT '',
        sample_deliverables jsonb NOT NULL DEFAULT '{"header":"","thumbs":[]}',
        faq jsonb NOT NULL DEFAULT '{"header":"","items":[]}',
        seo jsonb NOT NULL DEFAULT '{"title":"","description":""}',
        display_order integer,
        source_id text,
        service_id uuid REFERENCES services(id) ON DELETE SET NULL,
        solution_id uuid REFERENCES solutions(id) ON DELETE SET NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS workshops_slug_key ON workshops (slug);`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS workshops_source_id_key ON workshops (source_id) WHERE source_id IS NOT NULL;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workshops_display_order_idx ON workshops (display_order);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workshops_service_idx ON workshops (service_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workshops_solution_idx ON workshops (solution_id);`);

    // 14. faq_categories + faq_items — PR 49: DB-backed FAQ with per-question
    //     deep-link URLs for SEO / LLM-crawler indexing.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS faq_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL,
        name text NOT NULL,
        description text,
        display_order integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'published',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS faq_categories_slug_key ON faq_categories (slug);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS faq_categories_display_order_idx ON faq_categories (display_order);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS faq_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id uuid NOT NULL REFERENCES faq_categories(id) ON DELETE CASCADE,
        slug text NOT NULL,
        question text NOT NULL,
        answer_html text NOT NULL DEFAULT '',
        display_order integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'published',
        published_at timestamptz,
        seo_title text,
        seo_description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS faq_items_category_slug_key ON faq_items (category_id, slug);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS faq_items_category_idx ON faq_items (category_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS faq_items_display_order_idx ON faq_items (display_order);
    `);

    // 13. not_found_logs — PR 50: aggregate 404 hits so admins can map them
    //     to Wix redirects. One row per normalized path; hit_count / last_seen_at
    //     are bumped on repeat visits.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS not_found_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        normalized_path text NOT NULL,
        path text NOT NULL,
        hit_count integer NOT NULL DEFAULT 1,
        last_referrer text,
        last_user_agent text,
        resolved boolean NOT NULL DEFAULT false,
        notes text,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS not_found_logs_normalized_path_key
        ON not_found_logs (normalized_path);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS not_found_logs_resolved_hit_count_last_seen_idx
        ON not_found_logs (resolved, hit_count DESC, last_seen_at DESC);
    `);

    // 16. faq_categories + faq_items — #108: bring FAQ onto the shared
    //     artifact-type pattern. Adds the lifecycle columns (`title`,
    //     `unpublished_at`, `featured`, `featured_rank`, `active`,
    //     `source_id`, `og_image`, `deleted_at`) and converts `status` from
    //     plain text to the `artifact_status` enum. Existing values
    //     ('draft' / 'published') are preserved by the USING cast; the
    //     `published_at` column is backfilled for already-published rows
    //     so the visibility filter (which honors publish windows) doesn't
    //     hide content that was visible before the migration.

    // 16-pre. Ensure the artifact_status enum exists. Other artifact
    //         tables (applications, polaris_episodes, …) already create
    //         it via drizzle push, but if a fresh DB only has the
    //         hand-rolled FAQ tables this guard makes the conversion
    //         safe to run standalone.
    await db.execute(sql`
      DO $$
      BEGIN
        CREATE TYPE artifact_status AS ENUM ('draft', 'scheduled', 'published', 'archived');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    // 16a. New artifact-lifecycle columns. NOT NULL columns with non-null
    //      defaults are safe to add against an existing table.
    //      `published_at` already exists on faq_items (from #107) but not
    //      on faq_categories — IF NOT EXISTS makes the same statement
    //      safe for both. `og_image` from `artifactSeo` is intentionally
    //      omitted: the FAQ schema only spreads identity/lifecycle/
    //      timestamps, so adding the column would create dead weight
    //      with no Drizzle field or DTO surfacing it.
    //      Note: written as two explicit calls rather than a sql.raw() loop
    //      because sql.raw() inside a for-loop is silently dropped by Drizzle
    //      on this runtime.
    await db.execute(sql`
      ALTER TABLE faq_categories
        ADD COLUMN IF NOT EXISTS title text,
        ADD COLUMN IF NOT EXISTS published_at timestamptz,
        ADD COLUMN IF NOT EXISTS unpublished_at timestamptz,
        ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS featured_rank integer,
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS source_id text,
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    `);
    await db.execute(sql`
      ALTER TABLE faq_items
        ADD COLUMN IF NOT EXISTS title text,
        ADD COLUMN IF NOT EXISTS published_at timestamptz,
        ADD COLUMN IF NOT EXISTS unpublished_at timestamptz,
        ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS featured_rank integer,
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS source_id text,
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    `);

    // 16b. Backfill `title` from the existing display field. Categories
    //      use `name`, items use `question`.
    await db.execute(sql`
      UPDATE faq_categories SET title = name WHERE title IS NULL;
    `);
    await db.execute(sql`
      UPDATE faq_items SET title = question WHERE title IS NULL;
    `);
    await db.execute(sql`
      ALTER TABLE faq_categories ALTER COLUMN title SET NOT NULL;
    `);
    await db.execute(sql`
      ALTER TABLE faq_items ALTER COLUMN title SET NOT NULL;
    `);

    // 16c. faq_items already had `published_at` (from #107). For
    //      faq_categories it's new — fall back to created_at on rows that
    //      were already 'published' so the visibility filter doesn't hide
    //      them.
    await db.execute(sql`
      UPDATE faq_categories
        SET published_at = created_at
        WHERE published_at IS NULL AND status = 'published';
    `);
    await db.execute(sql`
      UPDATE faq_items
        SET published_at = created_at
        WHERE published_at IS NULL AND status = 'published';
    `);

    // 16d. Convert status from text → artifact_status. Existing values
    //      ('draft' / 'published') are valid enum members so the USING
    //      cast preserves them. Drop the old text default first because
    //      Postgres rejects the type change otherwise.
    //      Written as two explicit calls — see note on sql.raw() above.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'faq_categories'
            AND column_name = 'status'
            AND data_type = 'text'
        ) THEN
          ALTER TABLE faq_categories ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE faq_categories
            ALTER COLUMN status TYPE artifact_status
            USING status::artifact_status;
          ALTER TABLE faq_categories
            ALTER COLUMN status SET DEFAULT 'draft';
        END IF;
      END $$;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'faq_items'
            AND column_name = 'status'
            AND data_type = 'text'
        ) THEN
          ALTER TABLE faq_items ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE faq_items
            ALTER COLUMN status TYPE artifact_status
            USING status::artifact_status;
          ALTER TABLE faq_items
            ALTER COLUMN status SET DEFAULT 'draft';
        END IF;
      END $$;
    `);

    // 16e. Add the published_at index that the artifact pattern uses for
    //      sorting / filtering by publish window.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS faq_categories_published_at_idx
        ON faq_categories (published_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS faq_items_published_at_idx
        ON faq_items (published_at);
    `);

    // 17. bookings — PR53: Microsoft Bookings embed entries surfaced on /start.
    //     Each row holds one Bookings calendar URL with optional time-gating
    //     (startsAt / endsAt) and a scope tag (general | offer | conference).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug           text NOT NULL,
        title          text NOT NULL,
        teaser         text,
        description_html text,
        embed_url      text NOT NULL,
        scope          text NOT NULL DEFAULT 'general',
        starts_at      timestamptz,
        ends_at        timestamptz,
        display_order  integer NOT NULL DEFAULT 0,
        active         boolean NOT NULL DEFAULT true,
        seo_title      text,
        seo_description text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS bookings_slug_key ON bookings (slug);
    `);

    // 18. #110 + #111 — seven audience classes + DB-backed capability map.
    //
    // 18a. Ensure every role in ROLE_NAMES exists. Includes both the legacy
    //      five (admin/editor/author/contributor/client) and the new audience
    //      classes — the legacy rows already exist on production but inserting
    //      them here keeps the migration self-contained for fresh databases
    //      so step 18e's JOIN-based grant seed always finds a row to match.
    await db.execute(sql`
      INSERT INTO roles (name, description)
      VALUES
        ('admin',          'Legacy: full CMS admin'),
        ('editor',         'Legacy: editor with publish + moderate'),
        ('author',         'Legacy: author (draft only)'),
        ('contributor',    'Legacy: contributor (draft only)'),
        ('client',         'Legacy: portal access for approved client members'),
        ('site_admin',     'Audience class: full site administrator (alias of legacy admin)'),
        ('content_author', 'Audience class: editorial author with publish'),
        ('hr',             'Audience class: HR / careers (#109)'),
        ('internal',       'Audience class: Synozur internal staff'),
        ('customer',       'Audience class: client-org portal user (#135)'),
        ('registered',     'Audience class: self-service signed-in user')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 18b. capabilities table — canonical capability names.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS capabilities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS capabilities_name_key ON capabilities (name);
    `);

    // 18c. role_capabilities join table.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS role_capabilities (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        capability_id uuid NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        granted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (role_id, capability_id)
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS role_capabilities_capability_idx
        ON role_capabilities (capability_id);
    `);

    // 18d. Seed canonical capabilities. Mirrors CAPABILITY_NAMES /
    //      CAPABILITY_DESCRIPTIONS in lib/db/src/schema/capabilityMap.ts —
    //      keep the two in sync when adding a new capability. Idempotent
    //      via ON CONFLICT.
    await db.execute(sql`
      INSERT INTO capabilities (name, description) VALUES
        ('content.view',     'View admin content (posts, library, taxonomy).'),
        ('content.author',   'Create and edit draft content.'),
        ('content.publish',  'Publish, unpublish, and schedule content.'),
        ('content.moderate', 'Moderate comments and review marketing surfaces.'),
        ('users.manage',     'Manage users, roles, and access mappings.'),
        ('site.manage',      'Manage site-wide settings, redirects, and integrations.')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 18e. Seed default role → capability grants. Using a single SELECT-INSERT
    //      so adding a new role/capability above doesn't require a separate
    //      mapping insert here. Mirrors DEFAULT_ROLE_CAPABILITIES in
    //      schema/capabilityMap.ts. Existing rows are preserved (admin edits
    //      survive reseed).
    await db.execute(sql`
      WITH grants(role_name, cap_name) AS (
        VALUES
          ('admin',          'content.view'),
          ('admin',          'content.author'),
          ('admin',          'content.publish'),
          ('admin',          'content.moderate'),
          ('admin',          'users.manage'),
          ('admin',          'site.manage'),
          ('editor',         'content.view'),
          ('editor',         'content.author'),
          ('editor',         'content.publish'),
          ('editor',         'content.moderate'),
          ('author',         'content.view'),
          ('author',         'content.author'),
          ('contributor',    'content.view'),
          ('contributor',    'content.author'),
          ('site_admin',     'content.view'),
          ('site_admin',     'content.author'),
          ('site_admin',     'content.publish'),
          ('site_admin',     'content.moderate'),
          ('site_admin',     'users.manage'),
          ('site_admin',     'site.manage'),
          ('content_author', 'content.view'),
          ('content_author', 'content.author'),
          ('content_author', 'content.publish'),
          ('hr',             'content.view'),
          ('hr',             'users.manage'),
          ('internal',       'content.view')
      )
      INSERT INTO role_capabilities (role_id, capability_id)
      SELECT r.id, c.id
        FROM grants g
        JOIN roles r        ON r.name = g.role_name
        JOIN capabilities c ON c.name = g.cap_name
      ON CONFLICT DO NOTHING;
    `);

    // 18f. Retrofit a UNIQUE constraint on role_capabilities(role_id, capability_id).
    //      The original migration 18c defined PRIMARY KEY (role_id, capability_id) but
    //      if the table was created before that clause was added, CREATE TABLE IF NOT
    //      EXISTS is a no-op and the PK is never applied. Without a unique constraint
    //      the ON CONFLICT DO NOTHING above silently inserts duplicates on every restart.
    //      This step:
    //        1. Deduplicates existing rows (keeps the oldest ctid per pair).
    //        2. Adds the unique constraint exactly once using a DO block guard.
    await db.execute(sql`
      DELETE FROM role_capabilities rc
      WHERE ctid NOT IN (
        SELECT MIN(ctid)
        FROM role_capabilities
        GROUP BY role_id, capability_id
      );
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'role_capabilities'
            AND c.conname = 'role_capabilities_role_id_capability_id_key'
        ) THEN
          ALTER TABLE role_capabilities
            ADD CONSTRAINT role_capabilities_role_id_capability_id_key
            UNIQUE (role_id, capability_id);
        END IF;
      END$$;
    `);

    // 19. Bookings native (Graph) integration.
    //
    // 19a. site_settings.bookings_render_mode — global toggle between
    //      "iframe" (default, Microsoft-hosted page in an iframe) and
    //      "native" (custom on-brand React flow backed by Microsoft Graph).
    //      Defaulting to "iframe" preserves existing behavior on upgrade.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS bookings_render_mode text NOT NULL DEFAULT 'iframe';
    `);

    // 19b. bookings.{ms_business_id, ms_default_service_id} — per-row Graph
    //      configuration. Both nullable; rows missing ms_business_id always
    //      render via iframe even when the site mode is "native".
    await db.execute(sql`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS ms_business_id text,
        ADD COLUMN IF NOT EXISTS ms_default_service_id text;
    `);

    // 20. site_settings: *_media_id UUID columns — PR55 asset-library migration.
    //
    // PR55 added parallel UUID FK columns alongside the legacy integer *_asset_id
    // columns so the media picker can write to the unified media table while old
    // rows keep resolving through the legacy asset fallback. These columns were
    // added to the Drizzle schema but the migration step was missing, causing
    // every site-settings read to 500 with "column does not exist".
    //
    // All five columns are nullable; a null value means "use the legacy asset
    // column (if any) or the built-in default". FK enforcement is omitted here
    // to keep the ALTER idempotent — the route layer validates UUIDs before
    // writing them (PR55 review: siteSettings PATCH rejects unknown UUIDs with
    // a 400).
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS home_hero_image_media_id    uuid,
        ADD COLUMN IF NOT EXISTS home_editorial_image_media_id uuid,
        ADD COLUMN IF NOT EXISTS seo_default_og_image_media_id uuid,
        ADD COLUMN IF NOT EXISTS org_logo_media_id           uuid,
        ADD COLUMN IF NOT EXISTS home_hero_video_media_id    uuid;
    `);

    // 21. Linked bookings on content pages — optional FK from services,
    //     solutions, workshops, and applications to a booking row. When set,
    //     the public detail page renders a discreet BookingCard that links
    //     directly to /start/:slug instead of requiring the visitor to
    //     navigate to the /start index first.
    await db.execute(sql`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      ALTER TABLE solutions
        ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      ALTER TABLE workshops
        ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      ALTER TABLE applications
        ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
    `);

    // 22. Service / solution tagging for Polaris podcast episodes — lets
    //     editors associate an episode with the service or solution it covers
    //     so episode detail pages can cross-link to the relevant offer.
    await db.execute(sql`
      ALTER TABLE polaris_episodes
        ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      ALTER TABLE polaris_episodes
        ADD COLUMN IF NOT EXISTS solution_id uuid REFERENCES solutions(id) ON DELETE SET NULL;
    `);

    // 23. White papers: document_media_id — UUID FK to the media table so
    //     uploaded PDF documents can be tracked in the media library alongside
    //     the legacy document_asset_id / document_url fields.
    await db.execute(sql`
      ALTER TABLE white_papers
        ADD COLUMN IF NOT EXISTS document_media_id uuid REFERENCES media(id) ON DELETE SET NULL;
    `);

    // 24. White papers: service_id + solution_id — associate a document with a
    //     service and optionally one of that service's solutions (mirrors the
    //     same FK pair added to polaris_episodes in step 22).
    await db.execute(sql`
      ALTER TABLE white_papers
        ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      ALTER TABLE white_papers
        ADD COLUMN IF NOT EXISTS solution_id uuid REFERENCES solutions(id) ON DELETE SET NULL;
    `);

    // 25. Solutions: accelerators_html + faq_html — rich-text HTML fields for
    //     the Accelerators / Zenith callout section and the FAQ section on each
    //     solution detail page. Editors can now manage this content directly
    //     from the admin without running a seed script.
    await db.execute(sql`
      ALTER TABLE solutions
        ADD COLUMN IF NOT EXISTS accelerators_html text,
        ADD COLUMN IF NOT EXISTS faq_html text;
    `);

    // 26. Collateral type enum: add 'workshop' value so workshops can be synced
    //     into the library (collateral table) the same way videos, case studies,
    //     and events are.
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TYPE collateral_type ADD VALUE IF NOT EXISTS 'workshop';
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // 27. Legacy traffic ingestion — PR58. Adds provenance columns to the live
    //     traffic_* tables so bulk-imported Wix Analytics rows live alongside
    //     native first-party tracking and YTD reporting reads from one place.
    //     Also creates the import-batch and unmapped-path triage tables.
    //
    //     Defaults preserve existing rows as `source_system = 'native'` so
    //     reporting is unaffected until a legacy import actually runs.
    await db.execute(sql`
      ALTER TABLE traffic_sessions
        ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'native',
        ADD COLUMN IF NOT EXISTS import_batch_id uuid,
        ADD COLUMN IF NOT EXISTS legacy_session_key text;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS traffic_sessions_source_system_idx
        ON traffic_sessions (source_system, first_seen_at);
    `);
    // Composite unique index on (source_system, legacy_session_key) so a
    // second legacy source (e.g. ga4) can't collide with wix keys, and so
    // ON CONFLICT inference works without a partial-index predicate. Drops
    // any earlier index name a prior deploy may have created (the original
    // partial single-column index, or an interim short-named composite).
    await db.execute(sql`DROP INDEX IF EXISTS traffic_sessions_legacy_session_key_key;`);
    await db.execute(sql`DROP INDEX IF EXISTS traffic_sessions_source_legacy_key_key;`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS traffic_sessions_source_system_legacy_session_key_key
        ON traffic_sessions (source_system, legacy_session_key);
    `);

    await db.execute(sql`
      ALTER TABLE traffic_pageviews
        ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'native',
        ADD COLUMN IF NOT EXISTS import_batch_id uuid,
        ADD COLUMN IF NOT EXISTS pageview_count integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS resolved_path text;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS traffic_pageviews_source_system_idx
        ON traffic_pageviews (source_system, viewed_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS traffic_pageviews_resolved_path_idx
        ON traffic_pageviews (resolved_path, viewed_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS legacy_traffic_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_system text NOT NULL,
        source_file text NOT NULL,
        source_file_sha256 text NOT NULL,
        range_from timestamptz,
        range_to timestamptz,
        row_count integer NOT NULL DEFAULT 0,
        sessions_inserted integer NOT NULL DEFAULT 0,
        pageviews_inserted integer NOT NULL DEFAULT 0,
        unmapped_count integer NOT NULL DEFAULT 0,
        is_final boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS legacy_traffic_batches_file_sha_key
        ON legacy_traffic_batches (source_system, source_file_sha256);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS legacy_traffic_batches_created_at_idx
        ON legacy_traffic_batches (created_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS legacy_traffic_unmapped (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_system text NOT NULL,
        source_path text NOT NULL,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        occurrences integer NOT NULL DEFAULT 1,
        pageviews integer NOT NULL DEFAULT 0,
        sample_page_type text,
        notes text,
        resolved_at timestamptz,
        resolved_to_path text,
        sample jsonb
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS legacy_traffic_unmapped_source_key
        ON legacy_traffic_unmapped (source_system, source_path);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS legacy_traffic_unmapped_last_seen_idx
        ON legacy_traffic_unmapped (last_seen_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS legacy_traffic_unmapped_resolved_idx
        ON legacy_traffic_unmapped (resolved_at);
    `);

    // 28. SharePoint Embedded asset storage backend — PR59 (#127 Phase 2/3).
    //     Adds two overlay columns to `media` so each row can be read from
    //     either GCS (storage_key) or SPE (spe_file_id + spe_container_id)
    //     without rewriting the original storage_key. Also adds the runtime
    //     config knobs to `site_settings` that the SPE admin page manages.
    //
    //     All new columns are nullable (or have safe defaults) so existing
    //     rows are unaffected until the migration script populates them.
    await db.execute(sql`
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS spe_file_id text,
        ADD COLUMN IF NOT EXISTS spe_container_id text;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS media_storage_key_key
        ON media (storage_key);
    `);
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS spe_storage_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS spe_container_type_id text,
        ADD COLUMN IF NOT EXISTS spe_container_id_dev text,
        ADD COLUMN IF NOT EXISTS spe_container_id_prod text;
    `);

    // 28a. Storage backend selection — replaces the removed STORAGE_BACKEND env
    //      var. Two independent per-slot columns so dev and prod can be switched
    //      independently from the SPE admin page without a deploy.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS storage_backend_dev text NOT NULL DEFAULT 'gcs',
        ADD COLUMN IF NOT EXISTS storage_backend_prod text NOT NULL DEFAULT 'gcs';
    `);

    // 28b. Durable migration error column — set on permanent Graph 4xx failures
    //      so the file is excluded from future migration pages and admins can
    //      identify and retry it from the admin UI without reading ephemeral logs.
    await db.execute(sql`
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS spe_migrate_error text;
    `);

    // 29. AI grounding documents — Vega-pattern grounding store. Standalone
    //     admin-authored docs that get injected wholesale into the system
    //     prompt of every AI call (no chunking, no embeddings). Backs both
    //     the future "Ask Synozur" Q&A surface (#134) and the Astra concierge.
    //
    //     `scope_tags` (jsonb) replaces Vega's tenant_id since this site is
    //     single-tenant; null/empty = always inject. `concierge_eligible`
    //     lets a doc be excluded from the concierge prompt while remaining
    //     in the public Q&A corpus.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS grounding_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        description text,
        category text NOT NULL,
        content text NOT NULL,
        scope_tags jsonb,
        priority integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        concierge_eligible boolean NOT NULL DEFAULT true,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS grounding_documents_active_priority_idx
        ON grounding_documents (is_active, priority);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS grounding_documents_category_idx
        ON grounding_documents (category);
    `);

    // 29a. Seed the ai.grounding.manage capability + default grants. Mirrors
    //      CAPABILITY_NAMES and DEFAULT_ROLE_CAPABILITIES in
    //      lib/db/src/schema/capabilityMap.ts. Idempotent; existing
    //      admin-edited grants survive.
    await db.execute(sql`
      INSERT INTO capabilities (name, description) VALUES
        ('ai.grounding.manage',
         'Manage AI grounding documents that ground every AI call across the site.')
      ON CONFLICT (name) DO NOTHING;
    `);
    await db.execute(sql`
      WITH grants(role_name, cap_name) AS (
        VALUES
          ('admin',          'ai.grounding.manage'),
          ('editor',         'ai.grounding.manage'),
          ('site_admin',     'ai.grounding.manage'),
          ('content_author', 'ai.grounding.manage')
      )
      INSERT INTO role_capabilities (role_id, capability_id)
      SELECT r.id, c.id
        FROM grants g
        JOIN roles r        ON r.name = g.role_name
        JOIN capabilities c ON c.name = g.cap_name
      ON CONFLICT DO NOTHING;
    `);

    // 30. conversations + messages tables for the AI concierge / Ask Synozur surface.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id         serial PRIMARY KEY,
        title      text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id              serial PRIMARY KEY,
        conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            text NOT NULL,
        content         text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
        ON messages (conversation_id);
    `);

    // 31. Polaris episode → blog post link. Optional FK so an episode can be
    //     associated with a related blog post (typically one categorized as
    //     "Polaris" or "podcast"). When set, the public episode page renders
    //     the post as a featured card above the show notes.
    await db.execute(sql`
      ALTER TABLE polaris_episodes
        ADD COLUMN IF NOT EXISTS linked_post_id uuid REFERENCES posts(id) ON DELETE SET NULL;
    `);

    // 32. PR #64 — index on polaris_episodes.linked_post_id.
    //     The FK column was added in step 31 but no index was included.
    //     Partial index (WHERE linked_post_id IS NOT NULL) keeps the index
    //     small — the vast majority of episodes have no linked post.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_polaris_episodes_linked_post_id
        ON polaris_episodes (linked_post_id)
        WHERE linked_post_id IS NOT NULL;
    `);

    // 33. Drop unique constraint on polaris_episodes.episode_number.
    //     Episode numbers should be freely editable (e.g. correcting an import
    //     that assigned the wrong number) and podcast shows sometimes reuse or
    //     skip numbers. The old unique index prevented admins from changing a
    //     number to one that had already been assigned. Replaced with a plain
    //     non-unique index (polaris_episodes_number_idx) for query performance.
    await db.execute(sql`
      DROP INDEX IF EXISTS polaris_episodes_number_key;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS polaris_episodes_number_idx
        ON polaris_episodes (episode_number);
    `);

    // 34. Add linked_solution_id to posts so editors can explicitly pin a post
    //     to a solution; syncCollateral uses this to set collateral.solution_id.
    await db.execute(sql`
      ALTER TABLE posts
        ADD COLUMN IF NOT EXISTS linked_solution_id uuid REFERENCES solutions(id) ON DELETE SET NULL;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_posts_linked_solution_id
        ON posts (linked_solution_id)
        WHERE linked_solution_id IS NOT NULL;
    `);

    // 35. #128 — OAuth 2.0 / OIDC provider tables.
    //
    // Five tables back the provider surface: client registrations, RS256
    // signing keys, single-use authorization codes (hashed), opaque refresh
    // tokens with a rotation chain (hashed), and per-(user, client) consent
    // records. All credential-shaped values are stored as SHA-256 or bcrypt
    // hashes; the raw value only exists in the response that returned it.
    // Private signing keys are AES-256-GCM-encrypted at rest when OAUTH_KEK
    // is configured (see lib/oauthKeys.ts).

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id text NOT NULL,
        client_secret_hash text NOT NULL,
        name text NOT NULL,
        description text,
        redirect_uris text[] NOT NULL,
        allowed_scopes text[] NOT NULL,
        allowed_grant_types text[] NOT NULL,
        pkce_required boolean NOT NULL DEFAULT true,
        is_active boolean NOT NULL DEFAULT true,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS oauth_clients_client_id_key
        ON oauth_clients (client_id);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_signing_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kid text NOT NULL,
        algorithm text NOT NULL,
        public_key_pem text NOT NULL,
        private_key_material text NOT NULL,
        encryption_method text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        rotated_at timestamptz,
        retired_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS oauth_signing_keys_kid_key
        ON oauth_signing_keys (kid);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_signing_keys_active_idx
        ON oauth_signing_keys (is_active);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        code_hash text PRIMARY KEY,
        client_id text NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        redirect_uri text NOT NULL,
        scopes text[] NOT NULL,
        code_challenge text,
        code_challenge_method text,
        nonce text,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_auth_codes_user_idx
        ON oauth_authorization_codes (user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_idx
        ON oauth_authorization_codes (expires_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        token_hash text NOT NULL,
        client_id text NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scopes text[] NOT NULL,
        parent_token_id uuid,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS oauth_refresh_tokens_hash_key
        ON oauth_refresh_tokens (token_hash);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_idx
        ON oauth_refresh_tokens (user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_idx
        ON oauth_refresh_tokens (client_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_expires_idx
        ON oauth_refresh_tokens (expires_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_consents (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id text NOT NULL,
        scopes_granted text[] NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        PRIMARY KEY (user_id, client_id)
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_consents_client_idx
        ON oauth_consents (client_id);
    `);

    // 35a. Seed the oauth.manage capability and grant it to admin / site_admin
    //      so the new admin surface is reachable without a second migration.
    //      Mirrors CAPABILITY_NAMES / DEFAULT_ROLE_CAPABILITIES in
    //      schema/capabilityMap.ts.
    await db.execute(sql`
      INSERT INTO capabilities (name, description) VALUES
        ('oauth.manage', 'Register, rotate, and revoke OAuth client apps that authenticate against this site (#128).')
      ON CONFLICT (name) DO NOTHING;
    `);
    await db.execute(sql`
      WITH grants(role_name, cap_name) AS (
        VALUES
          ('admin',      'oauth.manage'),
          ('site_admin', 'oauth.manage')
      )
      INSERT INTO role_capabilities (role_id, capability_id)
      SELECT r.id, c.id
        FROM grants g
        JOIN roles r        ON r.name = g.role_name
        JOIN capabilities c ON c.name = g.cap_name
      ON CONFLICT DO NOTHING;
    `);
    // 36. csp_violations — #155 / launch readiness L4. Browser-posted CSP
    //     violation reports while the policy is rolled out in Report-Only
    //     mode. One row per (document_path, violated_directive, blocked_uri)
    //     dedup key; occurrences and last_seen_at are bumped on repeat
    //     reports so the table stays small.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS csp_violations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_path text NOT NULL,
        violated_directive text NOT NULL,
        effective_directive text,
        blocked_uri text NOT NULL,
        original_policy text,
        disposition text,
        status_code integer,
        user_agent text,
        raw_report jsonb,
        occurrences integer NOT NULL DEFAULT 1,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS csp_violations_dedup_idx
        ON csp_violations (document_path, violated_directive, blocked_uri);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS csp_violations_last_seen_idx
        ON csp_violations (last_seen_at);
    `);

    // 37. csp_violations: promote the dedup index from plain → UNIQUE.
    //     Migration 36 accidentally created a non-unique index, which causes
    //     the ON CONFLICT DO UPDATE upsert in /api/csp/report to fail with
    //     "there is no unique or exclusion constraint matching the ON CONFLICT
    //     specification". Drop the old index and recreate it as UNIQUE.
    //     Idempotent: DROP IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
    await db.execute(sql`
      DROP INDEX IF EXISTS csp_violations_dedup_idx;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS csp_violations_dedup_idx
        ON csp_violations (document_path, violated_directive, blocked_uri);
    `);

    // 38. Drop the transitional users.last_sso_provider column. Added during
    //     the OIDC migration as a discriminator; superseded by `auth_provider`,
    //     which is the canonical IdP signal. IF EXISTS makes this safe on
    //     databases where the column was never created (fresh installs after
    //     step 2 above stopped adding it).
    await db.execute(sql`
      ALTER TABLE users DROP COLUMN IF EXISTS last_sso_provider;
    `);

    // 39. Backfill `auth_provider = 'imported'` for placeholder author rows
    //     that survived the `clerk_user_id → external_subject` rename in
    //     step 1. Those historical rows kept their `external_subject`
    //     ('system:imported-from-wix' / 'import:wix:<slug>' / fixPostAuthors
    //     'imported:<local-part>') but `auth_provider` was never set, so the
    //     post-cleanup lookups in `tools/insights-crawler/{ingest,backfill-
    //     authors}.ts` and `scripts/linkImportedAuthors.ts` — which now
    //     filter on `auth_provider = 'imported' AND external_subject = …`
    //     to match the canonical pattern — would miss the historical rows
    //     and break idempotency on a pre-cleanup install.
    //
    //     Idempotent: only updates rows where `auth_provider IS NULL`, so
    //     re-running is a no-op and rows that are already canonical
    //     ('entra' / 'local' / etc.) are not touched.
    await db.execute(sql`
      UPDATE users
         SET auth_provider = 'imported'
       WHERE auth_provider IS NULL
         AND external_subject IS NOT NULL
         AND (
           external_subject = 'system:imported-from-wix'
           OR external_subject LIKE 'import:wix:%'
           OR external_subject LIKE 'imported:%'
         );
    `);

    // 40. site_settings: Alt Home (/home-b) hero override columns. Allow the
    //     /home-b hero to diverge from the original homepage hero from the
    //     admin CMS without forcing a global change. All three columns are
    //     nullable; null means "inherit from the corresponding homeHero*
    //     column" so the two pages stay in sync by default.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS home_b_hero_image_media_id uuid
          REFERENCES media(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS home_b_hero_video_media_id uuid
          REFERENCES media(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS home_b_hero_background_type text;
    `);

    // 41. site_settings.home_root_variant — #216: admin-controlled toggle
    //     that picks which homepage design ('a' or 'b') is served at the
    //     root URL. Defaulted to 'a' so existing installs continue to
    //     render the original Home variant at /; both variants stay
    //     reachable directly at /home-a and /home-b regardless.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS home_root_variant text NOT NULL DEFAULT 'a';
    `);

    // 42. site_settings — #215: editable copy for the alternate home page
    //     at /home-b. All 17 columns are nullable text; null/empty falls
    //     back to the hard-coded editorial defaults in
    //     `artifacts/synozur/src/pages/home-b.tsx`. Idempotent — safe to
    //     re-run on databases that already have these columns from a
    //     prior `pnpm db push`.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS home_b_hero_headline_prefix text,
        ADD COLUMN IF NOT EXISTS home_b_hero_headline_accent text,
        ADD COLUMN IF NOT EXISTS home_b_hero_headline_suffix text,
        ADD COLUMN IF NOT EXISTS home_b_hero_subheadline text,
        ADD COLUMN IF NOT EXISTS home_b_pillars_eyebrow text,
        ADD COLUMN IF NOT EXISTS home_b_pillars_headline text,
        ADD COLUMN IF NOT EXISTS home_b_pillar1_headline text,
        ADD COLUMN IF NOT EXISTS home_b_pillar1_body text,
        ADD COLUMN IF NOT EXISTS home_b_pillar2_headline text,
        ADD COLUMN IF NOT EXISTS home_b_pillar2_body text,
        ADD COLUMN IF NOT EXISTS home_b_pillar3_headline text,
        ADD COLUMN IF NOT EXISTS home_b_pillar3_body text,
        ADD COLUMN IF NOT EXISTS home_b_pillar4_headline text,
        ADD COLUMN IF NOT EXISTS home_b_pillar4_body text,
        ADD COLUMN IF NOT EXISTS home_b_closing_eyebrow text,
        ADD COLUMN IF NOT EXISTS home_b_closing_headline text,
        ADD COLUMN IF NOT EXISTS home_b_closing_body text;
    `);

    // 43. #61 — Revision history tables for services, solutions, methodologies,
    //     and capabilities. Each PATCH endpoint inserts a snapshot of the
    //     prior row before applying the update so editors can roll back
    //     accidental edits. Stored as jsonb so future column additions don't
    //     require a migration of the revision table itself.
    //
    //     The service/solution variants pre-existed in the schema but lacked
    //     an explicit production migration; methodology/capability are new.
    //     All four are idempotent (CREATE TABLE IF NOT EXISTS).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        snapshot_json jsonb NOT NULL,
        edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
        edited_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS service_revisions_service_edited_idx
        ON service_revisions (service_id, edited_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS solution_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        solution_id uuid NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
        snapshot_json jsonb NOT NULL,
        edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
        edited_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS solution_revisions_solution_edited_idx
        ON solution_revisions (solution_id, edited_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS service_methodology_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        methodology_id uuid NOT NULL
          REFERENCES service_methodologies(id) ON DELETE CASCADE,
        snapshot_json jsonb NOT NULL,
        edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
        edited_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS methodology_revisions_methodology_edited_idx
        ON service_methodology_revisions (methodology_id, edited_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS solution_capability_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        capability_id uuid NOT NULL
          REFERENCES solution_capabilities(id) ON DELETE CASCADE,
        snapshot_json jsonb NOT NULL,
        edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
        edited_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS capability_revisions_capability_edited_idx
        ON solution_capability_revisions (capability_id, edited_at);
    `);

    // 44. Galaxy customer portal v0 (#224).
    //     - client_organizations: account_manager_user_id, updated_at,
    //       deleted_at columns. The FK on account_manager_user_id is declared
    //       here (not via Drizzle's `.references()`) to avoid the circular
    //       import between users ↔ clientOrganizations.
    //     - client_organization_users: explicit membership join with a
    //       member|primary_contact role.
    //     - engagements: per-org workstream rows surfaced on the portal home.
    await db.execute(sql`
      ALTER TABLE client_organizations
        ADD COLUMN IF NOT EXISTS account_manager_user_id uuid,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'client_organizations'
            AND constraint_name = 'client_organizations_account_manager_user_id_fk'
        ) THEN
          ALTER TABLE client_organizations
            ADD CONSTRAINT client_organizations_account_manager_user_id_fk
            FOREIGN KEY (account_manager_user_id)
            REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS client_organization_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_organization_id uuid NOT NULL REFERENCES client_organizations(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'member',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS client_org_users_unique
        ON client_organization_users (user_id, client_organization_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_org_users_org_idx
        ON client_organization_users (client_organization_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_org_users_user_idx
        ON client_organization_users (user_id);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS engagements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_organization_id uuid NOT NULL REFERENCES client_organizations(id) ON DELETE CASCADE,
        title text NOT NULL,
        slug text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        summary text,
        started_at timestamptz,
        account_lead_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        external_ref text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS engagements_org_slug_key
        ON engagements (client_organization_id, slug);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS engagements_org_idx
        ON engagements (client_organization_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS engagements_status_idx
        ON engagements (status);
    `);

    // 45. #227 — Galaxy deliverables document browser
    // -----------------------------------------------------------
    // engagements gains an optional spe_path so the document
    // indexer knows which folder inside the active SPE container
    // to walk for each engagement. NULL means deliverables haven't
    // been wired up yet — the indexer skips those engagements.
    await db.execute(sql`
      ALTER TABLE engagements
        ADD COLUMN IF NOT EXISTS spe_path text;
    `);

    // portal_documents — one row per file an account manager has
    // indexed (and optionally published) from the engagement's
    // SPE folder. Galaxy clients only see published, non-deleted
    // rows. The unique (engagement, space_item_id) index makes
    // re-indexing idempotent.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
        spe_path text NOT NULL,
        space_item_id text NOT NULL,
        filename text NOT NULL,
        content_type text NOT NULL DEFAULT '',
        size_bytes bigint NOT NULL DEFAULT 0,
        last_modified_at timestamptz,
        published_at timestamptz,
        published_by uuid REFERENCES users(id) ON DELETE SET NULL,
        indexed_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        web_url text
      );
    `);
    // Existing deployments may have created the table before web_url
    // landed — add it idempotently so the Office "Open in browser"
    // affordance works without a manual migration.
    await db.execute(sql`
      ALTER TABLE portal_documents
        ADD COLUMN IF NOT EXISTS web_url text;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_documents_engagement_item_key
        ON portal_documents (engagement_id, space_item_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_documents_engagement_published_idx
        ON portal_documents (engagement_id, published_at);
    `);

    // 46. #225 — client-org admin: add account_manager role, client_orgs.manage
    //     capability, and client_org_invitations table.
    await db.execute(sql`
      INSERT INTO roles (name, description) VALUES
        ('account_manager', 'Audience class: client-org admin who can onboard and invite client users (#225)')
      ON CONFLICT (name) DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO capabilities (name, description) VALUES
        ('client_orgs.manage', 'Manage client organizations, their members, and invitations (#225).')
      ON CONFLICT (name) DO NOTHING;
    `);
    await db.execute(sql`
      WITH grants(role_name, cap_name) AS (
        VALUES
          ('admin',           'client_orgs.manage'),
          ('site_admin',      'client_orgs.manage'),
          ('account_manager', 'client_orgs.manage')
      )
      INSERT INTO role_capabilities (role_id, capability_id)
      SELECT r.id, c.id
        FROM grants g
        JOIN roles r        ON r.name = g.role_name
        JOIN capabilities c ON c.name = g.cap_name
      ON CONFLICT DO NOTHING;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS client_org_invitations (
        token text PRIMARY KEY,
        client_organization_id uuid NOT NULL REFERENCES client_organizations(id) ON DELETE CASCADE,
        email text NOT NULL,
        invited_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        role text NOT NULL DEFAULT 'member',
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_org_invitations_org_idx
        ON client_org_invitations (client_organization_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_org_invitations_email_idx
        ON client_org_invitations (email);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS client_org_invitations_expires_idx
        ON client_org_invitations (expires_at);
    `);

    // 47. Galaxy per-application cockpit (#226). portal_artifacts: curated
    //     artifacts published by an account manager (or, future, by the
    //     owning Synozur app via OAuth) for a specific client org. Used by
    //     Galaxy to render six per-app surfaces (Vega, Nebula, Constellation,
    //     Orion, Orbit, Zenith).
    await db.execute(sql`
      DO $$
      BEGIN
        CREATE TYPE portal_source_app AS ENUM (
          'vega','nebula','constellation','orion','orbit','zenith'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_artifacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_organization_id uuid NOT NULL
          REFERENCES client_organizations(id) ON DELETE CASCADE,
        source_app portal_source_app NOT NULL,
        artifact_kind text NOT NULL,
        title text NOT NULL,
        summary text,
        payload jsonb,
        external_url text,
        thumbnail text,
        published_at timestamptz,
        archived_at timestamptz,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_artifacts_org_app_published_idx
        ON portal_artifacts (client_organization_id, source_app, published_at DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS portal_artifacts_org_idx
        ON portal_artifacts (client_organization_id);
    `);

    // 48. #228 — Centralized multi-property traffic reporting.
    // Promote the free-text source_system column into a first-class
    // "property" concept. Existing values were `native` (live first-party
    // tracker) and `wix` (legacy bulk import); we remap to `synozur` and
    // `wix-legacy` so reporting can join cleanly on `traffic_properties.slug`.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS traffic_properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL,
        name text NOT NULL,
        base_url text,
        api_key_hash text,
        api_key_prefix text,
        is_default boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_ingested_at timestamptz
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS traffic_properties_slug_key
        ON traffic_properties (slug);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS traffic_property_imports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid NOT NULL REFERENCES traffic_properties(id) ON DELETE CASCADE,
        kind text NOT NULL,
        source_file text,
        source_file_sha256 text,
        accepted integer NOT NULL DEFAULT 0,
        skipped integer NOT NULL DEFAULT 0,
        duplicates integer NOT NULL DEFAULT 0,
        errors integer NOT NULL DEFAULT 0,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS traffic_property_imports_property_idx
        ON traffic_property_imports (property_id, created_at);
    `);

    // Backfill source_system: native → synozur, anything else → wix-legacy.
    // Idempotent — second-run UPDATEs touch zero rows.
    await db.execute(sql`
      UPDATE traffic_sessions SET source_system = 'synozur'
      WHERE source_system = 'native';
    `);
    await db.execute(sql`
      UPDATE traffic_pageviews SET source_system = 'synozur'
      WHERE source_system = 'native';
    `);
    await db.execute(sql`
      UPDATE traffic_sessions SET source_system = 'wix-legacy'
      WHERE source_system NOT IN ('synozur', 'wix-legacy');
    `);
    await db.execute(sql`
      UPDATE traffic_pageviews SET source_system = 'wix-legacy'
      WHERE source_system NOT IN ('synozur', 'wix-legacy');
    `);

    // Update column defaults so future inserts without an explicit value
    // are tagged as the built-in property.
    await db.execute(sql`
      ALTER TABLE traffic_sessions ALTER COLUMN source_system SET DEFAULT 'synozur';
    `);
    await db.execute(sql`
      ALTER TABLE traffic_pageviews ALTER COLUMN source_system SET DEFAULT 'synozur';
    `);

    // Seed the two built-in properties.
    await db.execute(sql`
      INSERT INTO traffic_properties (slug, name, base_url, is_default, is_active, notes)
      VALUES (
        'synozur',
        'Synozur Alliance (this app)',
        NULL,
        true,
        true,
        'Built-in property for first-party traffic collected via /api/traffic/collect.'
      )
      ON CONFLICT (slug) DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO traffic_properties (slug, name, base_url, is_default, is_active, notes)
      VALUES (
        'wix-legacy',
        'Wix (legacy)',
        NULL,
        false,
        true,
        'Historical traffic imported from the previous Wix site.'
      )
      ON CONFLICT (slug) DO NOTHING;
    `);

    // #167 — prompt-cache rollup table (renamed from `ai_chat_token_usage`
    // to `ai_chat_prompt_cache_usage` during the #166 rebase to make room
    // for the budget-enforcement table created later in this migration).
    //
    // Daily rollup of /ai/chat token usage so the Site Health dashboard
    // can chart prompt-cache hit rate, dollar savings, and page on-call
    // when the daily hit rate drops below 50%. One row per (utc_day,
    // model); each chat request upserts via ON CONFLICT.
    //
    // Counters use bigint because a chatty day's cache_read tokens can
    // get into the millions on multi-turn conversations with a large
    // grounding corpus, and we don't want the Site Health writer to
    // need to think about overflow. requestCount stays integer because
    // /ai/chat is rate-limited well below 2^31 hits/day.
    //
    // Forward-rename: if a previous deploy created the legacy
    // `ai_chat_token_usage` table with the rollup schema (id text PK +
    // utc_day + model), rename it now so the budget-enforcement table
    // below can claim the original name. Detected by the presence of the
    // `utc_day` column, which only exists in the rollup variant.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_chat_token_usage'
            AND column_name = 'utc_day'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ai_chat_prompt_cache_usage'
        ) THEN
          ALTER TABLE ai_chat_token_usage RENAME TO ai_chat_prompt_cache_usage;
          ALTER INDEX IF EXISTS ai_chat_token_usage_day_model_idx
            RENAME TO ai_chat_prompt_cache_usage_day_model_idx;
          ALTER INDEX IF EXISTS ai_chat_token_usage_last_seen_idx
            RENAME TO ai_chat_prompt_cache_usage_last_seen_idx;
        END IF;
      END $$;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_chat_prompt_cache_usage (
        id text PRIMARY KEY,
        utc_day date NOT NULL,
        model text NOT NULL,
        input_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0,
        cache_creation_input_tokens bigint NOT NULL DEFAULT 0,
        cache_read_input_tokens bigint NOT NULL DEFAULT 0,
        request_count integer NOT NULL DEFAULT 0,
        warm_request_count integer NOT NULL DEFAULT 0,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_chat_prompt_cache_usage_day_model_idx
        ON ai_chat_prompt_cache_usage (utc_day, model);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_chat_prompt_cache_usage_last_seen_idx
        ON ai_chat_prompt_cache_usage (last_seen_at);
    `);

    // #254 — SEO unpublish-submission audit table. Records per-channel
    // IndexNow / Google Indexing / Bing Webmaster ping results when content
    // transitions to a "gone" state, surfaced on /admin/site-config/launch-readiness.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS seo_unpublish_submissions (
        id serial PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        slug text NOT NULL,
        url text NOT NULL,
        channel text NOT NULL,
        ok boolean NOT NULL,
        http_status integer,
        submitted integer NOT NULL DEFAULT 0,
        error text,
        submitted_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS seo_unpublish_submissions_channel_submitted_at_idx
        ON seo_unpublish_submissions (channel, submitted_at);
    `);

    // #259 — Double opt-in subscribers table.
    //   Created here so a fresh deploy provisions the table before
    //   /forms/subscribe, the confirm route, the admin page, the daily
    //   cleanup cron, and the reconfirmation script all touch it.
    //   Backfill from form_submissions seeds existing pre-DOI subscribers
    //   as 'confirmed' (grandfathered) so they keep receiving until the
    //   one-shot reconfirmation campaign rotates them to 'pending'.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscribers (
        id serial PRIMARY KEY,
        email text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        source text,
        confirmation_token_hash text,
        confirmation_sent_at timestamptz,
        confirmed_at timestamptz,
        confirmed_ip text,
        confirmed_user_agent text,
        submitted_ip text,
        submitted_user_agent text,
        unsubscribed_at timestamptz,
        grandfathered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    // For environments where the table was created before grandfathered_at
    // was added, ensure the column exists.
    await db.execute(sql`
      ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS grandfathered_at timestamptz;
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_unique ON subscribers (email);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS subscribers_status_idx ON subscribers (status);
    `);
    // Backfill marks each row with grandfathered_at = now() so the
    // reconfirmation script can target only the pre-DOI cohort and never
    // touch organically-confirmed subscribers added after this migration.
    await db.execute(sql`
      INSERT INTO subscribers (email, status, source, submitted_ip, submitted_user_agent, confirmed_at, grandfathered_at, created_at)
      SELECT DISTINCT ON (lower(fs.email))
             lower(fs.email),
             'confirmed',
             COALESCE((fs.payload->>'source'), 'subscribe'),
             fs.ip_address,
             fs.user_agent,
             fs.created_at,
             now(),
             fs.created_at
      FROM form_submissions fs
      WHERE fs.form_type = 'subscribe' AND fs.email IS NOT NULL AND fs.email <> ''
      ORDER BY lower(fs.email), fs.created_at ASC
      ON CONFLICT (email) DO NOTHING;
    `);

    // 49. #262 — Ask Synozur: editorial corpus chunks + question telemetry.
    //     Phase-0 retrieval is FTS-based (per backlog #170); the
    //     editorial_embeddings vector column is deferred until an
    //     embeddings-API integration is available.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS editorial_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_kind text NOT NULL,
        source_id uuid NOT NULL,
        chunk_index integer NOT NULL,
        title text NOT NULL,
        url text NOT NULL,
        text text NOT NULL,
        embedding_model_version text,
        source_updated_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS editorial_chunks_source_chunk_key
        ON editorial_chunks (source_kind, source_id, chunk_index);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS editorial_chunks_source_idx
        ON editorial_chunks (source_kind, source_id);
    `);
    // FTS support: a generated tsvector that weights the title above the
    // body so a question matching the headline ranks higher than one that
    // only matches a passing mention deep in the body.
    await db.execute(sql`
      ALTER TABLE editorial_chunks
        ADD COLUMN IF NOT EXISTS text_search tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(text, '')),  'B')
        ) STORED;
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS editorial_chunks_text_search_idx
        ON editorial_chunks USING gin (text_search);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS insights_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question text NOT NULL,
        answer text NOT NULL DEFAULT '',
        sources jsonb NOT NULL DEFAULT '[]'::jsonb,
        model text,
        refused boolean NOT NULL DEFAULT false,
        low_confidence boolean NOT NULL DEFAULT false,
        source_count integer NOT NULL DEFAULT 0,
        top_score integer,
        click_through_count integer NOT NULL DEFAULT 0,
        session_id text,
        ip_hash text,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS insights_questions_created_at_idx
        ON insights_questions (created_at DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS insights_questions_refused_idx
        ON insights_questions (refused);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS insights_questions_low_conf_idx
        ON insights_questions (low_confidence);
    `);

    // -----------------------------------------------------------
    // #170 — Public-site search via Postgres FTS.
    //
    // Each indexed artifact table gets a generated `search_tsv tsvector`
    // column (title A / excerpt B / body C) plus a GIN index, so the
    // /api/search endpoint can run plainto_tsquery + ts_rank_cd against
    // every kind in parallel without an app-side trigger or backfill.
    // Generated columns can't be modeled via drizzle-kit push today, so
    // we own the DDL here and keep `IF NOT EXISTS` guards on every step.
    //
    // The body expression strips HTML tags via a regex (immutable, so it
    // works in a STORED generated column) before tokenization. JSON-typed
    // narrative fields (case_studies.challenge etc., applications
    // .description_paragraphs) are cast to text and have their JSON
    // punctuation collapsed to spaces by the same regex.
    // -----------------------------------------------------------

    const searchTsvSpecs: Array<{ table: string; expr: string }> = [
      {
        table: "posts",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(
              coalesce(body_html, '') || ' ' ||
              coalesce(body_markdown, '') || ' ' ||
              coalesce(subtitle, ''),
              '<[^>]+>', ' ', 'g'
            )
          ), 'C')`,
      },
      {
        table: "case_studies",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english',
            coalesce(headline, '') || ' ' || coalesce(summary, '')
          ), 'B') ||
          setweight(to_tsvector('english',
            translate(
              coalesce(challenge::text, '') || ' ' ||
              coalesce(approach::text, '') || ' ' ||
              coalesce(outcome::text, '') || ' ' ||
              coalesce(quote_text, ''),
              '<>"[]{},',
              '        '
            )
          ), 'C')`,
      },
      {
        table: "white_papers",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english',
            coalesce(short_description, '') || ' ' || coalesce(subtitle, '')
          ), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g')
          ), 'C')`,
      },
      {
        table: "services",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english',
            regexp_replace(coalesce(blurb_html, ''), '<[^>]+>', ' ', 'g')
          ), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(
              coalesce(hero_text_html, '') || ' ' ||
              coalesce(secondary_text_html, '') || ' ' ||
              coalesce(tertiary_text_html, ''),
              '<[^>]+>', ' ', 'g'
            )
          ), 'C')`,
      },
      {
        table: "solutions",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english',
            coalesce(blurb_copy, '') || ' ' ||
            regexp_replace(coalesce(blurb_html, ''), '<[^>]+>', ' ', 'g')
          ), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(
              coalesce(hero_text_html, '') || ' ' ||
              coalesce(secondary_text_html, '') || ' ' ||
              coalesce(our_approach_text_html, '') || ' ' ||
              coalesce(accelerators_html, ''),
              '<[^>]+>', ' ', 'g'
            )
          ), 'C')`,
      },
      {
        table: "faq_items",
        expr: `
          setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(seo_description, '')), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(coalesce(answer_html, ''), '<[^>]+>', ' ', 'g')
          ), 'C')`,
      },
      {
        table: "polaris_episodes",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(coalesce(transcript_html, ''), '<[^>]+>', ' ', 'g')
          ), 'C')`,
      },
      {
        table: "applications",
        expr: `
          setweight(to_tsvector('english',
            coalesce(title, '') || ' ' || coalesce(name, '')
          ), 'A') ||
          setweight(to_tsvector('english',
            coalesce(tagline, '') || ' ' || coalesce(short_summary, '')
          ), 'B') ||
          setweight(to_tsvector('english',
            translate(
              coalesce(description_paragraphs::text, ''),
              '<>"[]{},',
              '        '
            )
          ), 'C')`,
      },
      {
        table: "models",
        expr: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(short_description, '')), 'B') ||
          setweight(to_tsvector('english',
            regexp_replace(
              coalesce(long_description_html, '') || ' ' ||
              coalesce(dimensions_html, ''),
              '<[^>]+>', ' ', 'g'
            )
          ), 'C')`,
      },
    ];

    for (const { table, expr } of searchTsvSpecs) {
      // ALTER TABLE ... ADD COLUMN IF NOT EXISTS guarded so re-runs are
      // free; the GENERATED expression itself can't be redefined without
      // DROP COLUMN, which we deliberately don't do here — schema edits
      // must drop and re-add via a follow-up migration.
      await db.execute(
        sql.raw(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS search_tsv tsvector
             GENERATED ALWAYS AS (${expr.trim()}) STORED;`,
        ),
      );
      await db.execute(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS ${table}_search_tsv_idx
             ON ${table} USING GIN (search_tsv);`,
        ),
      );
    }

    // search_kind_boosts column (jsonb) on site_settings. Editorially
    // tuned per-kind multipliers; null = use the hard-coded defaults.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS search_kind_boosts jsonb;
    `);

    // search_queries telemetry table (#170).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS search_queries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query text NOT NULL,
        query_normalized text NOT NULL,
        result_count integer NOT NULL DEFAULT 0,
        clicked_kind text,
        clicked_rank integer,
        clicked_slug text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS search_queries_normalized_idx
        ON search_queries (query_normalized);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS search_queries_created_at_idx
        ON search_queries (created_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS search_queries_zero_result_idx
        ON search_queries (result_count, created_at);
    `);

    // #128 — OAuth public clients (PKCE-only SPAs like Galaxy). Adds an
    // `is_public` flag to oauth_clients so the token endpoint can authenticate
    // these clients by client_id alone.
    await db.execute(sql`
      ALTER TABLE oauth_clients
        ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
    `);

    // #169 — Audit log viewer + retention.
    // Indexes for the new global audit-log viewer and per-entity activity
    // tab. The (entity, entity_id) index already exists from the original
    // schema. Add (actor_id, at desc) for "what did this user do?" lookups
    // and (at desc) for the unfiltered global stream.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS audit_log_actor_at_idx
        ON audit_log (actor_id, at DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS audit_log_at_idx
        ON audit_log (at DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS audit_log_action_idx
        ON audit_log (action);
    `);
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS audit_log_retention_days integer NOT NULL DEFAULT 365;
    `);

    // ------------------------------------------------------------------
    // #166 — Lock down /ai/chat
    // ------------------------------------------------------------------
    // 1. Install a portable UUIDv7 generator. Postgres 18 ships uuidv7()
    //    natively but we still target older majors, so we define our own
    //    plpgsql function (timestamp-prefixed; sortable; collision-safe).
    //    CREATE OR REPLACE is idempotent so re-running is harmless.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $func$
      DECLARE
        unix_ts_ms bytea;
        uuid_bytes bytea;
      BEGIN
        unix_ts_ms := substring(
          int8send((extract(epoch from clock_timestamp()) * 1000)::bigint)
          from 3
        );
        uuid_bytes := unix_ts_ms || gen_random_bytes(10);
        -- Set version (7) in the high nibble of byte 6.
        uuid_bytes := set_byte(uuid_bytes, 6, (112 | (get_byte(uuid_bytes, 6) & 15)));
        -- Set RFC 4122 variant in the high two bits of byte 8.
        uuid_bytes := set_byte(uuid_bytes, 8, (128 | (get_byte(uuid_bytes, 8) & 63)));
        RETURN encode(uuid_bytes, 'hex')::uuid;
      END;
      $func$ LANGUAGE plpgsql VOLATILE;
    `);

    // 2. Create the new auxiliary tables first — the conversations
    //    backfill below references ai_chat_sessions for its sentinel row.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        token_hash text NOT NULL UNIQUE,
        ip_at_creation text,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_chat_sessions_expires_idx
        ON ai_chat_sessions (expires_at);
    `);

    // Budget-enforcement rollup. Distinct from the prompt-cache rollup
    // (`ai_chat_prompt_cache_usage`) above: this one is keyed by
    // (day, scope_type, scope_id) so the route can short-circuit before
    // the upstream Anthropic call when a session/IP/global daily cap is hit.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_chat_token_usage (
        day date NOT NULL,
        scope_type text NOT NULL,
        scope_id text NOT NULL,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        cache_read_tokens integer NOT NULL DEFAULT 0,
        cache_creation_tokens integer NOT NULL DEFAULT 0,
        call_count integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_chat_token_usage_pk
        ON ai_chat_token_usage (day, scope_type, scope_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_chat_token_usage_day_idx
        ON ai_chat_token_usage (day);
    `);

    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS ai_chat_daily_token_cap_per_session integer,
        ADD COLUMN IF NOT EXISTS ai_chat_daily_token_cap_global integer;
    `);

    // 3. Migrate conversations + messages from integer-serial PKs to
    //    UUIDv7 PKs while *preserving* every existing row. Existing rows
    //    have no recoverable owner (the pre-#166 schema didn't track
    //    one), so we stamp them onto a single sentinel ai_chat_sessions
    //    row whose token_hash is non-resolvable and whose revoked_at is
    //    set in the past — meaning the rows are owned (passing the ACL
    //    NOT NULL invariant) but unreachable by any real caller.
    await db.execute(sql`
      DO $mig$
      DECLARE
        legacy_session uuid;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'conversations'
            AND column_name = 'id'
            AND data_type = 'integer'
        ) THEN
          INSERT INTO ai_chat_sessions
            (token_hash, ip_at_creation, user_agent, expires_at, revoked_at)
          VALUES (
            'legacy-pre-166-backfill-sentinel',
            NULL,
            'legacy-pre-166-backfill',
            now() + interval '100 years',
            now()
          )
          ON CONFLICT (token_hash) DO UPDATE
            SET token_hash = EXCLUDED.token_hash
          RETURNING id INTO legacy_session;

          ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS id_uuid uuid NOT NULL DEFAULT uuidv7(),
            ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS owner_session_id uuid;

          UPDATE conversations
             SET owner_session_id = legacy_session
             WHERE owner_session_id IS NULL AND owner_user_id IS NULL;

          ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS conversation_id_uuid uuid,
            ADD COLUMN IF NOT EXISTS input_tokens integer,
            ADD COLUMN IF NOT EXISTS output_tokens integer,
            ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
            ADD COLUMN IF NOT EXISTS cache_creation_tokens integer;

          UPDATE messages m
             SET conversation_id_uuid = c.id_uuid
             FROM conversations c
             WHERE m.conversation_id_uuid IS NULL
               AND m.conversation_id = c.id;

          ALTER TABLE messages
            DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
          ALTER TABLE messages DROP COLUMN conversation_id;
          ALTER TABLE messages RENAME COLUMN conversation_id_uuid TO conversation_id;
          ALTER TABLE messages ALTER COLUMN conversation_id SET NOT NULL;

          ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_pkey;
          ALTER TABLE messages DROP COLUMN id;
          ALTER TABLE messages
            ADD COLUMN id uuid PRIMARY KEY DEFAULT uuidv7();

          ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_pkey;
          ALTER TABLE conversations DROP COLUMN id;
          ALTER TABLE conversations RENAME COLUMN id_uuid TO id;
          ALTER TABLE conversations ALTER COLUMN id SET DEFAULT uuidv7();
          ALTER TABLE conversations ADD PRIMARY KEY (id);

          ALTER TABLE messages
            ADD CONSTRAINT messages_conversation_id_fkey
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
        END IF;
      END $mig$;
    `);

    // 4. Fresh-install path: if conversations doesn't exist yet at all
    //    (a brand-new database), create it and messages directly with
    //    the UUIDv7 schema.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        title text NOT NULL,
        owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        owner_session_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS conversations_owner_user_idx
        ON conversations (owner_user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS conversations_owner_session_idx
        ON conversations (owner_session_id);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        input_tokens integer,
        output_tokens integer,
        cache_read_tokens integer,
        cache_creation_tokens integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_conversation_idx
        ON messages (conversation_id, created_at);
    `);
    // Idempotent column adds for environments that already have a uuid
    // conversations/messages schema but missed any of the new columns.
    await db.execute(sql`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS input_tokens integer,
        ADD COLUMN IF NOT EXISTS output_tokens integer,
        ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
        ADD COLUMN IF NOT EXISTS cache_creation_tokens integer;
    `);
    await db.execute(sql`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS owner_session_id uuid;
    `);

    // #221 — Transactional email tracking. `email_messages` records each
    //        outbound send keyed by SendGrid's X-Message-Id; `email_events`
    //        captures webhook events from /api/email/sendgrid-webhook and
    //        links them back via `email_message_id` (sg_message_id prefix
    //        match performed at ingest time).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id text NOT NULL,
        to_email text NOT NULL,
        subject text NOT NULL,
        template text NOT NULL,
        latest_event text,
        latest_event_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS email_messages_message_id_key
        ON email_messages (message_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_messages_created_at_idx
        ON email_messages (created_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_messages_template_idx
        ON email_messages (template);
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS email_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email_message_id uuid REFERENCES email_messages(id) ON DELETE SET NULL,
        sg_message_id text NOT NULL,
        event text NOT NULL,
        email_addr text,
        reason text,
        payload jsonb NOT NULL,
        event_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_events_message_idx
        ON email_events (email_message_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_events_sg_message_idx
        ON email_events (sg_message_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_events_event_at_idx
        ON email_events (event_at);
    `);

    // #269 — LocalBusiness JSON-LD office contact fields. Nullable so the
    // /contact JSON-LD blob can fall back to the in-component Mill Creek
    // defaults when an admin hasn't set a value.
    await db.execute(sql`
      ALTER TABLE site_settings
        ADD COLUMN IF NOT EXISTS org_telephone text,
        ADD COLUMN IF NOT EXISTS org_geo_latitude double precision,
        ADD COLUMN IF NOT EXISTS org_geo_longitude double precision,
        ADD COLUMN IF NOT EXISTS org_opening_hours jsonb;
    `);
    logger.info("Startup migrations complete");
  } catch (err) {
    logger.error({ err }, "Startup migration failed — server will continue but some features may not work");
  }
}
