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
# drizzle-kit push cannot automatically cast integer → uuid
# (Postgres rejects ALTER COLUMN SET DATA TYPE uuid without a USING
# clause). The schema defines id as uuid for both tables, so we
# convert any still-integer PK/FK columns here — before drizzle push
# runs — using DROP COLUMN + ADD COLUMN (which IS always safe).
#
# The startup migration in migrations.ts does the same conversion at
# server boot and preserves conversation data by using a side column.
# Here we only care that the dev DB schema matches the drizzle schema
# so push can proceed; dev chat history loss is acceptable.
#
# Idempotent: the IF EXISTS guards make this a no-op if already uuid.
psql "$DATABASE_URL" -c "
DO \$pre_push\$
BEGIN
  -- ── Case 1: conversations.id is still integer ──────────────────
  -- The whole chat schema is pre-#166. Convert conversations and
  -- messages together so FK integrity is maintained.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations'
      AND column_name = 'id'
      AND data_type   = 'integer'
  ) THEN
    -- Drop FK from messages → conversations
    ALTER TABLE messages
      DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
    -- Drop messages PK and old columns
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_pkey;
    ALTER TABLE messages DROP COLUMN IF EXISTS id;
    ALTER TABLE messages DROP COLUMN IF EXISTS conversation_id;
    -- Drop conversations PK
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_pkey;
    ALTER TABLE conversations DROP COLUMN IF EXISTS id;
    -- Rebuild with uuid
    ALTER TABLE conversations ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
    ALTER TABLE messages     ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
    ALTER TABLE messages     ADD COLUMN conversation_id uuid NOT NULL DEFAULT gen_random_uuid();
    -- Restore FK
    ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;

  -- ── Case 2: messages.id is integer but conversations.id is uuid ─
  -- Partial migration state; only messages.id needs fixing.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages'
      AND column_name = 'id'
      AND data_type   = 'integer'
  ) THEN
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_pkey;
    ALTER TABLE messages DROP COLUMN IF EXISTS id;
    ALTER TABLE messages ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
  END IF;

  -- ── Case 3: messages.conversation_id is integer ─────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages'
      AND column_name = 'conversation_id'
      AND data_type   = 'integer'
  ) THEN
    ALTER TABLE messages
      DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
    ALTER TABLE messages DROP COLUMN IF EXISTS conversation_id;
    ALTER TABLE messages ADD COLUMN conversation_id uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;

  -- ── ai_chat_sessions.token_hash unique constraint ────────────────
  -- drizzle-kit names this ai_chat_sessions_token_hash_unique.
  -- If the constraint exists under our hand-named key
  -- (ai_chat_sessions_token_hash_key) but not under drizzle's name,
  -- drizzle push prompts interactively. Ensure drizzle's name exists
  -- so push is fully non-interactive.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_chat_sessions_token_hash_unique'
  ) THEN
    BEGIN
      ALTER TABLE ai_chat_sessions
        ADD CONSTRAINT ai_chat_sessions_token_hash_unique UNIQUE (token_hash);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END;
  END IF;
END \$pre_push\$;
" 2>/dev/null || true

pnpm --filter db push

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
