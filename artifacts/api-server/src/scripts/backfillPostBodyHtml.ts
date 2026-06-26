/**
 * Backfill body_html for posts that were created via the MCP server before
 * the post-write tool was updated to populate body_html from body_markdown.
 *
 * Idempotent: only updates rows where body_html IS NULL and body_markdown
 * IS NOT NULL. Safe to re-run.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run script:backfill-post-body-html
 */

import { pool } from "@workspace/db";
import { marked } from "marked";

async function main() {
  const { rows } = await pool.query<{ id: string; slug: string; body_markdown: string }>(
    `SELECT id, slug, body_markdown
       FROM posts
      WHERE body_html IS NULL
        AND body_markdown IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY created_at`,
  );

  if (rows.length === 0) {
    console.log("Nothing to backfill — all posts already have body_html.");
    return;
  }

  console.log(`Backfilling body_html for ${rows.length} post(s)…`);

  for (const row of rows) {
    const bodyHtml = String(await marked(row.body_markdown));
    await pool.query(`UPDATE posts SET body_html = $1 WHERE id = $2`, [bodyHtml, row.id]);
    console.log(`  ✓ ${row.slug}`);
  }

  console.log(`Done — ${rows.length} post(s) updated.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => void pool.end());
