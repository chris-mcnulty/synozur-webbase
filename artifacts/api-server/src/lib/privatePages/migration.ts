import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** No content, memberships, credentials or publication decisions are seeded. */
export async function migratePrivateCustomerPages(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS private_customer_pages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid REFERENCES client_organizations(id) ON DELETE RESTRICT,
      title text NOT NULL,
      slug text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      revision integer NOT NULL DEFAULT 1,
      reviewed_revision integer,
      reviewed_at timestamptz,
      reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      published_at timestamptz,
      published_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT private_customer_pages_status_check CHECK (status IN ('draft', 'published', 'archived')),
      CONSTRAINT private_customer_pages_revision_check CHECK (revision > 0),
      CONSTRAINT private_customer_pages_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      CONSTRAINT private_customer_pages_publication_check CHECK (
        status <> 'published' OR (
          organization_id IS NOT NULL AND published_at IS NOT NULL
          AND reviewed_revision IS NOT NULL AND reviewed_revision = revision
          AND reviewed_at IS NOT NULL
        )
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS private_customer_pages_org_slug_key
      ON private_customer_pages(organization_id, slug);
    CREATE INDEX IF NOT EXISTS private_customer_pages_org_status_idx
      ON private_customer_pages(organization_id, status);

    CREATE TABLE IF NOT EXISTS private_customer_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id uuid NOT NULL REFERENCES private_customer_pages(id) ON DELETE RESTRICT,
      revision integer NOT NULL,
      kind text NOT NULL,
      state text NOT NULL DEFAULT 'uploading',
      container_id text,
      item_id text,
      filename text NOT NULL,
      content_type text NOT NULL,
      size_bytes bigint,
      sha256 text,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT private_customer_assets_kind_check CHECK (kind IN ('html', 'audio', 'transcript')),
      CONSTRAINT private_customer_assets_state_check CHECK (state IN ('uploading', 'ready', 'failed', 'retired')),
      CONSTRAINT private_customer_assets_revision_check CHECK (revision > 0),
      CONSTRAINT private_customer_assets_ready_check CHECK (
        state <> 'ready' OR (
          container_id IS NOT NULL AND item_id IS NOT NULL
          AND size_bytes IS NOT NULL AND size_bytes > 0
          AND sha256 IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$'
        )
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS private_customer_assets_revision_kind_key
      ON private_customer_assets(page_id, revision, kind);
    CREATE INDEX IF NOT EXISTS private_customer_assets_storage_idx
      ON private_customer_assets(container_id, item_id);

    CREATE TABLE IF NOT EXISTS shared_organization_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL REFERENCES client_organizations(id) ON DELETE RESTRICT,
      username text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT true,
      credential_version integer NOT NULL DEFAULT 1,
      password_rotated_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shared_organization_accounts_username_check
        CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
      CONSTRAINT shared_organization_accounts_version_check CHECK (credential_version > 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS shared_organization_accounts_user_key
      ON shared_organization_accounts(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS shared_organization_accounts_username_key
      ON shared_organization_accounts(username);
    ALTER TABLE shared_organization_accounts DROP CONSTRAINT IF EXISTS shared_organization_accounts_username_check;
    ALTER TABLE shared_organization_accounts ADD CONSTRAINT shared_organization_accounts_username_check
      CHECK (username ~ '^[a-z0-9][a-z0-9._@+-]{2,127}$');
    CREATE TABLE IF NOT EXISTS shared_organization_sessions (
      token_hash text PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES shared_organization_accounts(id) ON DELETE CASCADE,
      credential_version integer NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS shared_organization_sessions_account_idx
      ON shared_organization_sessions(account_id);
    CREATE TABLE IF NOT EXISTS shared_login_attempts (
      bucket_hash text PRIMARY KEY,
      attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL
    );
    CREATE OR REPLACE FUNCTION protect_shared_identity() RETURNS trigger AS $$
    BEGIN
      IF OLD.auth_provider = 'shared_org' AND (
        NEW.auth_provider IS DISTINCT FROM OLD.auth_provider OR
        NEW.email IS DISTINCT FROM OLD.email OR
        NEW.password_hash IS DISTINCT FROM OLD.password_hash OR
        NEW.external_subject IS DISTINCT FROM OLD.external_subject OR
        NEW.entra_object_id IS DISTINCT FROM OLD.entra_object_id OR
        NEW.entra_tenant_id IS DISTINCT FROM OLD.entra_tenant_id OR
        (NEW.client_organization_id IS NOT NULL AND
         NEW.client_organization_id IS DISTINCT FROM OLD.client_organization_id)
      ) THEN RAISE EXCEPTION 'Shared identity cannot be linked, recovered or reassigned'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS protect_shared_identity ON users;
    CREATE TRIGGER protect_shared_identity BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION protect_shared_identity();
    CREATE OR REPLACE FUNCTION protect_shared_role() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND auth_provider='shared_org')
      THEN RAISE EXCEPTION 'Shared identities cannot receive roles'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS protect_shared_role ON user_roles;
    CREATE TRIGGER protect_shared_role BEFORE INSERT OR UPDATE ON user_roles
      FOR EACH ROW EXECUTE FUNCTION protect_shared_role();
    CREATE OR REPLACE FUNCTION protect_shared_binding() RETURNS trigger AS $$
    BEGIN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      THEN RAISE EXCEPTION 'Shared account binding is immutable'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS protect_shared_binding ON shared_organization_accounts;
    CREATE TRIGGER protect_shared_binding BEFORE UPDATE ON shared_organization_accounts
      FOR EACH ROW EXECUTE FUNCTION protect_shared_binding();
  `);
}
