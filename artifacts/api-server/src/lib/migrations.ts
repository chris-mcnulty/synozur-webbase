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

    // 2. users: new columns.
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS auth_provider text,
        ADD COLUMN IF NOT EXISTS entra_tenant_id text,
        ADD COLUMN IF NOT EXISTS entra_object_id text,
        ADD COLUMN IF NOT EXISTS last_sso_provider text,
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

    logger.info("Startup migrations complete");
  } catch (err) {
    logger.error({ err }, "Startup migration failed — server will continue but some features may not work");
  }
}
