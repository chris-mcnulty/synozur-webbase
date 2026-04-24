import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, lte, sql, isNull, inArray } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  postsTable,
  commentsTable,
  categoriesTable,
  tagsTable,
  postCategories,
  postTags,
  mediaTable,
  usersTable,
  postViewsTable,
} from "@workspace/db";
import crypto from "node:crypto";
import { serializePosts } from "../lib/postSerializer";
import { audit } from "../lib/audit";
import { verifyTurnstile } from "../lib/turnstile";
import { sendCommentReplyEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ListQuery = z.object({
  categorySlug: z.string().optional(),
  tagSlug: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

router.get("/insights", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { categorySlug, tagSlug, page, pageSize } = parsed.data;
  const filters = [
    isNull(postsTable.deletedAt),
    eq(postsTable.status, "published"),
    lte(postsTable.publishedAt, new Date()),
  ];
  let restrictPostIds: string[] | null = null;
  if (categorySlug) {
    const ids = await db
      .select({ postId: postCategories.postId })
      .from(postCategories)
      .innerJoin(categoriesTable, eq(postCategories.categoryId, categoriesTable.id))
      .where(eq(categoriesTable.slug, categorySlug));
    restrictPostIds = ids.map((r) => r.postId);
  }
  if (tagSlug) {
    const ids = await db
      .select({ postId: postTags.postId })
      .from(postTags)
      .innerJoin(tagsTable, eq(postTags.tagId, tagsTable.id))
      .where(eq(tagsTable.slug, tagSlug));
    const tagIds = ids.map((r) => r.postId);
    restrictPostIds = restrictPostIds
      ? restrictPostIds.filter((id) => tagIds.includes(id))
      : tagIds;
  }
  if (restrictPostIds !== null) {
    if (restrictPostIds.length === 0) {
      res.json({ items: [], page, pageSize, total: 0 });
      return;
    }
    filters.push(inArray(postsTable.id, restrictPostIds));
  }

  const where = and(...filters);
  const offset = (page - 1) * pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(postsTable)
      .where(where)
      .orderBy(desc(postsTable.publishedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(postsTable).where(where),
  ]);

  const fullItems = await serializePosts(items);
  // Public list strips bodyHtml/markdown to keep payload small.
  const publicItems = fullItems.map(({ bodyHtml, bodyMarkdown, ...rest }) => rest);
  res.json({ items: publicItems, page, pageSize, total: totalRow[0]?.c ?? 0 });
});

router.get("/insights/rss.xml", async (_req, res) => {
  const items = await db
    .select()
    .from(postsTable)
    .where(
      and(
        isNull(postsTable.deletedAt),
        eq(postsTable.status, "published"),
        lte(postsTable.publishedAt, new Date()),
      ),
    )
    .orderBy(desc(postsTable.publishedAt))
    .limit(50);

  const serialized = await serializePosts(items);
  const siteUrl = (process.env.SITE_URL || "https://www.synozur.com").replace(/\/$/, "");
  const feedSelf = `${siteUrl}/api/insights/rss.xml`;

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const cdata = (s: string) => `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;

  const xmlItems = serialized
    .map((p) => {
      const link = `${siteUrl}/insights/${p.slug}`;
      const pub = p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString();
      const cats = (p.categories || []).map((c) => `<category>${escape(c.name)}</category>`).join("");
      const author = p.author?.displayName ? `<dc:creator>${escape(p.author.displayName)}</dc:creator>` : "";
      const desc = p.excerpt ? `<description>${cdata(p.excerpt)}</description>` : "";
      const content = p.bodyHtml
        ? `<content:encoded>${cdata(p.bodyHtml)}</content:encoded>`
        : "";
      return [
        "<item>",
        `<title>${escape(p.title)}</title>`,
        `<link>${escape(link)}</link>`,
        `<guid isPermaLink="true">${escape(link)}</guid>`,
        `<pubDate>${pub}</pubDate>`,
        cats,
        author,
        desc,
        content,
        "</item>",
      ].join("");
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>The Synozur Alliance — The Feed</title>
<link>${escape(siteUrl)}/insights</link>
<atom:link href="${escape(feedSelf)}" rel="self" type="application/rss+xml" />
<description>Original writing from The Synozur Alliance on transformation, technology, leadership, and the operating disciplines that let strategy ship.</description>
<language>en-us</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${xmlItems}
</channel>
</rss>`;

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(xml);
});

router.get("/insights/:slug", async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post || (post.publishedAt && post.publishedAt > new Date())) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [serialized] = await serializePosts([post]);
  res.json(serialized);
});

router.get("/insights/:slug/comments", async (req, res) => {
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      id: commentsTable.id,
      parentCommentId: commentsTable.parentCommentId,
      authorName: commentsTable.authorName,
      bodyText: commentsTable.bodyText,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .where(and(eq(commentsTable.postId, post.id), eq(commentsTable.status, "approved")))
    .orderBy(commentsTable.createdAt);
  res.json(
    rows.map((r) => ({
      id: r.id,
      parentCommentId: r.parentCommentId,
      authorName: r.authorName,
      bodyText: r.bodyText,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const SubmitBody = z.object({
  authorName: z.string().min(1).max(120),
  authorEmail: z.string().email(),
  bodyText: z.string().min(1).max(5000),
  parentCommentId: z.string().uuid().nullish(),
  website: z.string().optional().nullable(),
  // #54: CAPTCHA fallback. Only enforced when TURNSTILE_SECRET_KEY is set.
  turnstileToken: z.string().optional().nullable(),
  // #53: opt-in for transactional notifications to the commenter's email.
  // The commenter will be emailed when the comment is approved and when a
  // reply is posted, subject to the moderator's per-action toggle.
  notifyOnApproval: z.boolean().optional(),
  notifyOnReply: z.boolean().optional(),
});

function ipKey(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xff = Array.isArray(req.headers["x-forwarded-for"])
    ? (req.headers["x-forwarded-for"] as string[])[0]
    : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = xff || req.ip || "0.0.0.0";
  return ipKeyGenerator(ip);
}

// Per-task: 3 / minute and 20 / day per IP. When tripped, we *silently*
// return a 202 (matching the success shape) and only log internally so
// bots can't tell they've been throttled.
const minuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `c:m:${ipKey(req)}`,
  handler: silentLimitHandler,
});

const dailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `c:d:${ipKey(req)}`,
  handler: silentLimitHandler,
});

function silentLimitHandler(req: import("express").Request, res: import("express").Response): void {
  void audit({
    action: "comment.rate_limited",
    entity: "comment",
    entityId: "",
    actorId: ipKey(req),
  });
  res.status(202).json({ id: "00000000-0000-0000-0000-000000000000", status: "pending" });
}

router.post("/insights/:slug/comments", dailyLimiter, minuteLimiter, async (req, res) => {
  const parsed = SubmitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  // Honeypot — silently accept and discard so bots can't tell they were caught.
  if (parsed.data.website && parsed.data.website.trim() !== "") {
    await audit({ action: "comment.honeypot", entity: "comment", entityId: "" });
    res.status(202).json({ id: "00000000-0000-0000-0000-000000000000", status: "pending" });
    return;
  }
  const ip =
    (Array.isArray(req.headers["x-forwarded-for"])
      ? req.headers["x-forwarded-for"][0]
      : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()) ||
    req.ip ||
    null;
  // CAPTCHA check (#54). No-op when TURNSTILE_SECRET_KEY is unset, so local
  // dev and environments without Turnstile configured keep working.
  const captchaOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!captchaOk) {
    await audit({ action: "comment.captcha_failed", entity: "comment", entityId: "" });
    res.status(202).json({ id: "00000000-0000-0000-0000-000000000000", status: "pending" });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .insert(commentsTable)
    .values({
      postId: post.id,
      parentCommentId: parsed.data.parentCommentId ?? null,
      authorName: parsed.data.authorName,
      authorEmail: parsed.data.authorEmail,
      bodyText: parsed.data.bodyText,
      ip,
      userAgent: req.headers["user-agent"] ?? null,
      status: "pending",
      notifyOnApproval: parsed.data.notifyOnApproval ?? false,
      notifyOnReply: parsed.data.notifyOnReply ?? false,
    })
    .returning({ id: commentsTable.id, status: commentsTable.status });
  await audit({ action: "comment.submit", entity: "comment", entityId: row.id });

  // #53: only send reply notifications for replies that are already approved.
  // We resolve the top-level ancestor (matching the UI's one-level
  // threading) so double-depth replies still notify the original author.
  if (parsed.data.parentCommentId && row.status === "approved") {
    void (async () => {
      try {
        let ancestor = await db.query.commentsTable.findFirst({
          where: eq(commentsTable.id, parsed.data.parentCommentId!),
        });
        while (ancestor?.parentCommentId) {
          const next = await db.query.commentsTable.findFirst({
            where: eq(commentsTable.id, ancestor.parentCommentId),
          });
          if (!next) break;
          ancestor = next;
        }
        if (
          ancestor &&
          ancestor.notifyOnReply &&
          ancestor.authorEmail &&
          ancestor.authorEmail.trim() !== "" &&
          ancestor.authorEmail.toLowerCase() !== parsed.data.authorEmail.toLowerCase()
        ) {
          await sendCommentReplyEmail({
            to: ancestor.authorEmail,
            parentCommenterName: ancestor.authorName,
            replyAuthorName: parsed.data.authorName,
            postTitle: post.title,
            postSlug: post.slug,
            replyCommentId: row.id,
            replyBodyText: parsed.data.bodyText,
          });
        }
      } catch (err) {
        logger.warn({ err }, "comment reply notification failed");
      }
    })();
  }

  res.status(202).json({ id: row.id, status: row.status });
});

// Lightweight view tracker. Public endpoint; rate-limited per IP.
// Same-session repeat hits within 30 min are deduped via a session hash.
const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `v:m:${ipKey(req)}`,
  handler: (_req, res) => {
    res.status(202).json({ ok: true });
  },
});

const ViewBody = z.object({
  referrer: z.string().max(2048).optional().nullable(),
});

function hostFromReferrer(ref: string | null | undefined, selfHost: string | null): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    const h = u.hostname.toLowerCase();
    if (selfHost && h === selfHost.toLowerCase()) return null;
    return h;
  } catch {
    return null;
  }
}

router.post("/insights/:slug/view", viewLimiter, async (req, res) => {
  const parsed = ViewBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(202).json({ ok: true });
    return;
  }
  const post = await db.query.postsTable.findFirst({
    where: and(
      eq(postsTable.slug, String(req.params.slug)),
      isNull(postsTable.deletedAt),
      eq(postsTable.status, "published"),
    ),
  });
  if (!post || (post.publishedAt && post.publishedAt > new Date())) {
    res.status(202).json({ ok: true });
    return;
  }

  const ip = ipKey(req);
  const ua = (req.headers["user-agent"] as string | undefined) ?? "";
  // 30-minute session bucket to dedupe repeated hits per (ip,ua,post).
  const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
  const sessionHash = crypto
    .createHash("sha256")
    .update(`${ip}|${ua}|${post.id}|${bucket}`)
    .digest("hex")
    .slice(0, 32);

  const existing = await db
    .select({ id: postViewsTable.id })
    .from(postViewsTable)
    .where(and(eq(postViewsTable.postId, post.id), eq(postViewsTable.sessionHash, sessionHash)))
    .limit(1);
  if (existing.length > 0) {
    res.status(202).json({ ok: true });
    return;
  }

  const selfHost = (() => {
    const h = req.headers.host as string | undefined;
    if (!h) return null;
    return h.split(":")[0];
  })();
  const referrerUrl = parsed.data.referrer?.trim() || null;
  const referrerHost = hostFromReferrer(referrerUrl, selfHost);

  await db.insert(postViewsTable).values({
    postId: post.id,
    sessionHash,
    referrerUrl: referrerUrl?.slice(0, 2048) ?? null,
    referrerHost,
    userAgent: ua.slice(0, 512) || null,
  });

  res.status(202).json({ ok: true });
});

export default router;
