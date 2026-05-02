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

    logger.info("Startup migrations complete");
  } catch (err) {
    logger.error({ err }, "Startup migration failed — server will continue but some features may not work");
  }
}
