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
      CREATE UNIQUE INDEX IF NOT EXISTS entra_group_role_unique
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

    logger.info("Startup migrations complete");
  } catch (err) {
    logger.error({ err }, "Startup migration failed — server will continue but some features may not work");
  }
}
