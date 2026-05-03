#!/bin/bash
set -e

# Self-heal Replit task-agent git plumbing on every post-merge tick:
# prunes dead subrepl-* remotes, clears stale index.lock, installs a
# pre-push hook that re-runs the same cleanup. Never fails the merge.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/git-hygiene.sh" || true

pnpm install --frozen-lockfile
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
