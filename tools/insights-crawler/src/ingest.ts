/**
 * One-shot ingest of the crawler dataset (`output/posts.json` + `output/images/`)
 * into the CMS database. Each image is uploaded to Replit App Storage via the
 * sidecar's signed PUT URL endpoint, registered in the `media` table, and the
 * post's body HTML is rewritten to point at the new App Storage URLs before
 * the post row is inserted.
 *
 * Idempotent: skips posts whose slug already exists, unless `--force` is given,
 * in which case existing rows are updated in place (categories re-linked,
 * images re-uploaded). Requires `--yes` to actually run.
 *
 * Usage:
 *   pnpm --filter @workspace/insights-crawler run ingest -- --yes
 *   pnpm --filter @workspace/insights-crawler run ingest -- --yes --force
 *   pnpm --filter @workspace/insights-crawler run ingest -- --yes --slug=foo
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  postsTable,
  usersTable,
  mediaTable,
  categoriesTable,
  postCategories,
  auditLogTable,
  teamMembersTable,
} from "@workspace/db";
import { PostsFileSchema, type Post, type PostImage } from "./schema.js";

const OUTPUT_DIR = resolve(import.meta.dirname, "../output");
const POSTS_PATH = `${OUTPUT_DIR}/posts.json`;
const REPLIT_SIDECAR = "http://127.0.0.1:1106";
const IMPORTED_AUTH_PROVIDER = "imported";
const SYSTEM_AUTHOR_SUBJECT = "system:imported-from-wix";
const SYSTEM_AUTHOR_NAME = "Imported from Wix";
const IMPORT_AUTHOR_SUBJECT_PREFIX = "import:wix:";

// Wix exports occasionally surface a login handle instead of the display name.
// Map known handle variants back to the canonical name so posts by the same
// author collapse onto a single user record.
const AUTHOR_NAME_ALIASES: Record<string, string> = {
  andrewborg88: "Andrew Borg",
};

const FORCE = process.argv.includes("--force");
const YES = process.argv.includes("--yes");
const ONLY_SLUG = process.argv.find((a) => a.startsWith("--slug="))?.slice(7);

interface UploadedMedia {
  mediaId: string;
  publicUrl: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mimeFor(localPath: string): string {
  const ext = extname(localPath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function getSignedUploadUrl(): Promise<{
  signedUrl: string;
  publicPath: string;
}> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not set. Cannot upload to App Storage. " +
        "Run from an environment with object-storage configured.",
    );
  }
  const objectId = randomUUID();
  // Mirror artifacts/api-server/src/lib/objectStorage.ts: uploads land under
  // `${PRIVATE_OBJECT_DIR}/uploads/<uuid>`; the public path is `/objects/<uuid>`.
  const fullPath = `${privateDir.replace(/\/$/, "")}/uploads/${objectId}`;
  const m = fullPath.match(/^\/?([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${privateDir}`);
  const bucketName = m[1];
  const objectName = m[2];

  const res = await fetch(`${REPLIT_SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to sign upload URL: ${res.status} ${await res.text()}`);
  }
  const { signed_url } = (await res.json()) as { signed_url: string };
  return { signedUrl: signed_url, publicPath: `/objects/uploads/${objectId}` };
}

async function uploadImage(
  systemUserId: string,
  img: PostImage,
  altText: string,
): Promise<UploadedMedia> {
  const fullLocal = resolve(OUTPUT_DIR, img.localPath);
  const buf = await readFile(fullLocal);
  const mime = mimeFor(img.localPath);
  const { signedUrl, publicPath } = await getSignedUploadUrl();
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: buf,
  });
  if (!put.ok) {
    throw new Error(`Upload failed for ${img.localPath}: ${put.status} ${await put.text()}`);
  }
  const [row] = await db
    .insert(mediaTable)
    .values({
      storageKey: publicPath,
      publicUrl: publicPath,
      mime,
      byteSize: buf.byteLength,
      altText: altText || null,
      uploadedBy: systemUserId,
    })
    .returning({ id: mediaTable.id });
  return { mediaId: row.id, publicUrl: publicPath };
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

function normalizeAuthorName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return AUTHOR_NAME_ALIASES[trimmed] ?? trimmed;
}

/**
 * Resolve a per-author user record for an imported post. Posts authored by the
 * same person share one row (keyed on `authProvider="imported"` +
 * `externalSubject="import:wix:<slug>"`) so their display name shows up on the
 * blog. Falls back to the generic system author when the source post has no
 * `authorName`.
 *
 * These placeholders intentionally have `email: null` because the Wix export
 * carries display names, not addresses. The OIDC callback's email-fallback
 * branch in `routes/auth.ts` cannot match them (no email to compare against),
 * so they will NOT be auto-upgraded on first Entra sign-in. To retire a
 * placeholder, run `artifacts/api-server/src/scripts/fixPostAuthors.ts` first
 * (which assigns canonical emails per the KNOWN_AUTHORS table) and then
 * `linkImportedAuthors.ts` to pre-populate the directory linkage so the
 * callback can absorb the row on next sign-in.
 */
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

  // If this author also has a public team-member profile, reuse its photo and
  // short bio so the "Written by" card on the post page looks complete.
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

async function ensureCategory(name: string): Promise<string> {
  const slug = slugify(name);
  const existing = await db.query.categoriesTable.findFirst({
    where: eq(categoriesTable.slug, slug),
  });
  if (existing) return existing.id;
  const [row] = await db
    .insert(categoriesTable)
    .values({ slug, name, description: null })
    .onConflictDoNothing()
    .returning({ id: categoriesTable.id });
  if (row) return row.id;
  const refetch = await db.query.categoriesTable.findFirst({
    where: eq(categoriesTable.slug, slug),
  });
  if (!refetch) throw new Error(`Failed to upsert category ${name}`);
  return refetch.id;
}

function rewriteBody(html: string, replacements: Map<string, string>): string {
  // Replace any src="<localPath>" with src="<publicUrl>". The crawler stores
  // local paths like `images/<slug>/hero.png` (relative to OUTPUT_DIR).
  let out = html;
  for (const [local, publicUrl] of replacements.entries()) {
    // Escape regex special chars in the local path.
    const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(["'])${escaped}\\1`, "g"), `"${publicUrl}"`);
  }
  return out;
}

async function ingestPost(
  systemUserId: string,
  post: Post,
): Promise<"created" | "updated" | "skipped" | "failed"> {
  if (post.status === "failed") return "skipped";
  const existing = await db.query.postsTable.findFirst({
    where: eq(postsTable.slug, post.slug),
  });
  if (existing && !FORCE) return "skipped";

  // Upload images.
  const replacements = new Map<string, string>();
  let heroMediaId: string | null = null;
  if (post.heroImage) {
    try {
      const up = await uploadImage(systemUserId, post.heroImage, post.title);
      heroMediaId = up.mediaId;
      replacements.set(post.heroImage.localPath, up.publicUrl);
    } catch (err) {
      console.warn(`  ! hero upload failed for ${post.slug}:`, err);
    }
  }
  for (const img of post.bodyImages) {
    if (replacements.has(img.localPath)) continue;
    try {
      const up = await uploadImage(systemUserId, img, "");
      replacements.set(img.localPath, up.publicUrl);
    } catch (err) {
      console.warn(`  ! body image upload failed (${img.localPath}):`, err);
    }
  }

  const bodyHtml = rewriteBody(post.bodyHtml, replacements);
  const publishedAt = post.publishedAt ? new Date(post.publishedAt) : new Date();
  const seoTitle = post.seo.title;
  const seoDescription = post.seo.description ?? post.excerpt ?? null;
  const authorId = await ensureAuthorForName(post.authorName, systemUserId);

  let postId: string;
  if (existing) {
    await db
      .update(postsTable)
      .set({
        title: post.title,
        subtitle: post.subtitle,
        excerpt: post.excerpt,
        bodyHtml,
        bodyMarkdown: post.bodyMarkdown,
        heroImageId: heroMediaId ?? existing.heroImageId,
        ogImageId: heroMediaId ?? existing.ogImageId,
        authorId,
        seoTitle,
        seoDescription,
        seoCanonicalUrl: post.sourceUrl,
        readingTimeMin: post.readingTimeMinutes,
        status: "published",
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(postsTable.id, existing.id));
    postId = existing.id;
    // Re-link categories.
    await db.delete(postCategories).where(eq(postCategories.postId, postId));
  } else {
    const [row] = await db
      .insert(postsTable)
      .values({
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        excerpt: post.excerpt,
        bodyHtml,
        bodyMarkdown: post.bodyMarkdown,
        heroImageId: heroMediaId,
        ogImageId: heroMediaId,
        authorId,
        status: "published",
        publishedAt,
        seoTitle,
        seoDescription,
        seoCanonicalUrl: post.sourceUrl,
        readingTimeMin: post.readingTimeMinutes,
      })
      .returning({ id: postsTable.id });
    postId = row.id;
  }

  // Categories.
  const catIds: string[] = [];
  for (const cat of post.categories) {
    catIds.push(await ensureCategory(cat));
  }
  if (catIds.length) {
    await db
      .insert(postCategories)
      .values(catIds.map((categoryId) => ({ postId, categoryId })))
      .onConflictDoNothing();
  }

  await db.insert(auditLogTable).values({
    actorId: systemUserId,
    action: existing ? "post.import.update" : "post.import.create",
    entity: "post",
    entityId: postId,
    diffJson: { source: post.sourceUrl, originalAuthor: post.authorName } as never,
  });

  return existing ? "updated" : "created";
}

async function main() {
  if (!YES) {
    console.error(
      "Refusing to run without --yes flag. This script writes ~135 posts and " +
        "uploads ~365 images into the App Storage bucket. Re-run with --yes.",
    );
    process.exit(2);
  }
  const raw = await readFile(POSTS_PATH, "utf8");
  const all = PostsFileSchema.parse(JSON.parse(raw));
  const posts = ONLY_SLUG ? all.filter((p) => p.slug === ONLY_SLUG) : all;
  if (!posts.length) {
    console.error("No posts to ingest.");
    process.exit(1);
  }

  console.log(
    `Ingesting ${posts.length} post(s) into the CMS database.${FORCE ? " (--force)" : ""}`,
  );
  const systemUserId = await ensureSystemAuthor();
  console.log(`System author user id: ${systemUserId}`);

  let created = 0,
    updated = 0,
    skipped = 0,
    failed = 0;
  for (const post of posts) {
    process.stdout.write(`- ${post.slug}: `);
    try {
      const result = await ingestPost(systemUserId, post);
      console.log(result);
      if (result === "created") created++;
      else if (result === "updated") updated++;
      else if (result === "skipped") skipped++;
    } catch (err) {
      failed++;
      const e = err as { message?: string; cause?: { message?: string } };
      console.log("failed:", e.cause?.message ?? e.message ?? String(err));
    }
  }

  console.log(
    `\nDone. created=${created} updated=${updated} skipped=${skipped} failed=${failed}`,
  );
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
