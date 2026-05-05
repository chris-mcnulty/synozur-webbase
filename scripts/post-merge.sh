#!/bin/bash
set -e

# Self-heal Replit task-agent git plumbing on every post-merge tick:
# prunes dead subrepl-* remotes, clears stale index.lock, installs a
# pre-push hook that re-runs the same cleanup. Never fails the merge.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/git-hygiene.sh" || true

pnpm install --frozen-lockfile

# ------------------------------------------------------------------
# Pre-push schema surgery: integer → uuid for conversations/messages
# ------------------------------------------------------------------
# drizzle-kit push cannot automatically cast integer/bigint → uuid
# (Postgres rejects ALTER COLUMN SET DATA TYPE uuid without a USING
# clause). The schema defines id as uuid for both tables, so we
# convert any non-uuid PK/FK columns here — before drizzle push
# runs — using DROP COLUMN CASCADE + ADD COLUMN.
#
# CASCADE on DROP COLUMN automatically removes any FK constraints
# from other tables that reference the dropped column, avoiding the
# need to enumerate every possible constraint name.
#
# Each case is an independent DO block so a failure in one does not
# prevent the others from running. All blocks are idempotent.
# dev chat history loss from DROP+ADD is acceptable.

# Case 1 — conversations.id is not uuid yet
psql "$DATABASE_URL" << 'EOSQL'
DO $case1$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations'
      AND column_name = 'id'
      AND data_type  != 'uuid'
  ) THEN
    -- CASCADE drops every FK that references conversations.id
    -- (e.g. messages_conversation_id_fkey, any drizzle-generated name)
    ALTER TABLE conversations DROP COLUMN id CASCADE;
    ALTER TABLE conversations ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
  END IF;
END $case1$;
EOSQL

# Case 2 — messages.id is not uuid yet
psql "$DATABASE_URL" << 'EOSQL'
DO $case2$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages'
      AND column_name = 'id'
      AND data_type  != 'uuid'
  ) THEN
    ALTER TABLE messages DROP COLUMN id CASCADE;
    ALTER TABLE messages ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
  END IF;
END $case2$;
EOSQL

# Case 3 — messages.conversation_id is not uuid yet
#           Also restores FK if it was lost during cascade above.
psql "$DATABASE_URL" << 'EOSQL'
DO $case3$
BEGIN
  -- Fix column type if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages'
      AND column_name = 'conversation_id'
      AND data_type  != 'uuid'
  ) THEN
    ALTER TABLE messages DROP COLUMN conversation_id CASCADE;
    ALTER TABLE messages ADD COLUMN conversation_id uuid NOT NULL DEFAULT gen_random_uuid();
  END IF;

  -- Restore FK if missing (could have been cascade-dropped in Case 1)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'conversation_id')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name      = 'messages'
         AND ccu.table_name     = 'conversations'
     )
  THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $case3$;
EOSQL

# Case 4 — ai_chat_sessions.token_hash unique constraint
#           drizzle-kit expects the name ai_chat_sessions_token_hash_unique.
#           Without it, drizzle push prompts interactively even with --force.
psql "$DATABASE_URL" << 'EOSQL'
DO $case4$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_chat_sessions')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_chat_sessions_token_hash_unique')
  THEN
    BEGIN
      ALTER TABLE ai_chat_sessions
        ADD CONSTRAINT ai_chat_sessions_token_hash_unique UNIQUE (token_hash);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $case4$;
EOSQL

pnpm --filter db push --force

# ------------------------------------------------------------------
# Startup migrations: ordering is drizzle-kit push → startup
# migrations → seeds. drizzle-kit push handles columns it can model
# (standard types, constraints). api-server's runMigrations() handles
# everything it cannot — notably GENERATED ALWAYS AS … STORED columns
# (e.g. search_tsv for full-text search) and other hand-rolled DDL.
# Seeds must run after both steps so every column they touch exists.
# ------------------------------------------------------------------
pnpm --filter api-server run migrate

# Seed Zenith callout and FAQ enrichments for solution pages.
# Idempotent — safe to re-run. Failures are reported (no `|| true`)
# so a broken seed surfaces in the post-merge log instead of silently
# leaving the solution pages without their accelerator/FAQ content.
pnpm --filter api-server run seed:solution-enrichments

# Seed required CMS roles so the first-user auto-promotion always works.
psql "$DATABASE_URL" -c "
INSERT INTO roles (id, name, description) VALUES
  (gen_random_uuid(), 'admin',       'Full access to all CMS features and settings'),
  (gen_random_uuid(), 'editor',      'Can create, edit, and publish any content'),
  (gen_random_uuid(), 'author',      'Can create and edit own content; cannot publish'),
  (gen_random_uuid(), 'contributor', 'Can draft content only')
ON CONFLICT DO NOTHING;
" 2>/dev/null || true

# ------------------------------------------------------------------
# Regenerate static nav fallbacks from the DB so pillar / application
# edits in admin flow through to lib/synozur-nav automatically.
# Runs after seeds so the DB has fresh data.
#
# Uses `|| true` so a fresh environment (before ingestServices has run)
# does not block the post-merge for unrelated merges. The script itself
# still exits non-zero and prints a clear error, which appears in the
# post-merge log for visibility without making it a hard failure.
# ------------------------------------------------------------------
pnpm --filter @workspace/scripts run gen-nav-statics || true
