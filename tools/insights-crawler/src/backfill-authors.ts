/**
 * Backfill real author user records onto posts that were imported from Wix
 * before the importer learned to preserve original author names. For each
 * post listed in `output/posts.json`, ensures a user row exists for the
 * original `authorName` (sharing `ensureAuthorForName` semantics with
 * `ingest.ts`) and repoints the post's `authorId` at that user. No other
 * post fields are touched, so manual CMS edits remain intact.
 *
 * Idempotent. Requires `--yes` to actually write.
 *
 *   pnpm --filter @workspace/insights-crawler exec tsx src/backfill-authors.ts -- --yes
 *   pnpm --filter @workspace/insights-crawler exec tsx src/backfill-authors.ts -- --yes --slug=foo
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  postsTable,
  usersTable,
  teamMembersTable,
  auditLogTable,
} from "@workspace/db";
import { PostsFileSchema } from "./schema.js";

const OUTPUT_DIR = resolve(import.meta.dirname, "../output");
const POSTS_PATH = `${OUTPUT_DIR}/posts.json`;
const IMPORTED_AUTH_PROVIDER = "imported";
const SYSTEM_AUTHOR_SUBJECT = "system:imported-from-wix";
const SYSTEM_AUTHOR_NAME = "Imported from Wix";
const IMPORT_AUTHOR_SUBJECT_PREFIX = "import:wix:";

const AUTHOR_NAME_ALIASES: Record<string, string> = {
  andrewborg88: "Andrew Borg",
};

const YES = process.argv.includes("--yes");
const ONLY_SLUG = process.argv.find((a) => a.startsWith("--slug="))?.slice(7);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeAuthorName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return AUTHOR_NAME_ALIASES[trimmed] ?? trimmed;
}

async function ensureSystemAuthor(): Promise<string> {
  const existing = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.authProvider, IMPORTED_AUTH_PROVIDER),
      eq(usersTable.externalSubject, SYSTEM_AUTHOR_SUBJECT),
    ),
  });
  if (existing) return existing.id;
  const [row] = await db
    .insert(usersTable)
    .values({
      authProvider: IMPORTED_AUTH_PROVIDER,
      externalSubject: SYSTEM_AUTHOR_SUBJECT,
      email: null,
      displayName: SYSTEM_AUTHOR_NAME,
      avatarUrl: null,
      bio: "Posts migrated from the prior Wix-hosted blog at synozur.com/insights.",
    })
    .returning({ id: usersTable.id });
  return row.id;
}

async function ensureAuthorForName(
  rawName: string | null,
  systemUserId: string,
): Promise<string> {
  const name = normalizeAuthorName(rawName);
  if (!name) return systemUserId;
  const slug = slugify(name);
  if (!slug) return systemUserId;
  const subject = `${IMPORT_AUTHOR_SUBJECT_PREFIX}${slug}`;

  const existing = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.authProvider, IMPORTED_AUTH_PROVIDER),
      eq(usersTable.externalSubject, subject),
    ),
  });
  if (existing) return existing.id;

  const teamMember = await db.query.teamMembersTable.findFirst({
    where: eq(teamMembersTable.slug, slug),
  });

  const [row] = await db
    .insert(usersTable)
    .values({
      authProvider: IMPORTED_AUTH_PROVIDER,
      externalSubject: subject,
      email: null,
      displayName: name,
      avatarUrl: teamMember?.imageUrl ?? null,
      bio: teamMember?.shortDescription ?? null,
    })
    .returning({ id: usersTable.id });
  return row.id;
}

async function main() {
  if (!YES) {
    console.error("Refusing to run without --yes flag.");
    process.exit(2);
  }
  const raw = await readFile(POSTS_PATH, "utf8");
  const all = PostsFileSchema.parse(JSON.parse(raw));
  const posts = ONLY_SLUG ? all.filter((p) => p.slug === ONLY_SLUG) : all;
  if (!posts.length) {
    console.error("No posts to backfill.");
    process.exit(1);
  }

  const systemUserId = await ensureSystemAuthor();
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  for (const post of posts) {
    const existing = await db.query.postsTable.findFirst({
      where: eq(postsTable.slug, post.slug),
    });
    if (!existing) {
      missing++;
      console.log(`- ${post.slug}: missing in db`);
      continue;
    }
    const newAuthorId = await ensureAuthorForName(post.authorName, systemUserId);
    if (existing.authorId === newAuthorId) {
      unchanged++;
      continue;
    }
    await db
      .update(postsTable)
      .set({ authorId: newAuthorId, updatedAt: new Date() })
      .where(eq(postsTable.id, existing.id));
    await db.insert(auditLogTable).values({
      actorId: systemUserId,
      action: "post.import.backfill-author",
      entity: "post",
      entityId: existing.id,
      diffJson: {
        from: existing.authorId,
        to: newAuthorId,
        authorName: post.authorName,
      } as never,
    });
    updated++;
    console.log(`- ${post.slug}: ${existing.authorId} -> ${newAuthorId} (${post.authorName})`);
  }

  console.log(`\nDone. updated=${updated} unchanged=${unchanged} missing=${missing}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
