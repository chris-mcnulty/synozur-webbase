import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ne, asc, sql } from "drizzle-orm";
import {
  db,
  videosTable,
  VIDEO_CATEGORIES,
  VIDEO_STATUSES,
  type Video,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import {
  upsertCollateralFromVideo,
  softDeleteCollateralForVideo,
} from "../lib/syncCollateral";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

async function ensureUniqueVideoSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.videosTable.findFirst({
      where: excludeId
        ? and(eq(videosTable.slug, slug), ne(videosTable.id, excludeId))
        : eq(videosTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(v: Video) {
  return {
    id: v.id,
    slug: v.slug,
    title: v.title,
    category: v.category,
    videoUrl: v.videoUrl,
    thumbnailUrl: v.thumbnailUrl,
    heroImage: v.heroImage,
    heroImageAlt: v.heroImageAlt,
    shortDescription: v.shortDescription,
    bodyHtml: v.bodyHtml,
    tags: v.tags,
    pillar: v.pillar,
    recordedAt: v.recordedAt,
    durationSeconds: v.durationSeconds,
    status: v.status,
    publishedAt: v.publishedAt,
    unpublishedAt: v.unpublishedAt,
    featured: v.featured,
    featuredRank: v.featuredRank,
    seoTitle: v.seoTitle,
    seoDescription: v.seoDescription,
    ogImage: v.ogImage,
    active: v.active,
    sourceId: v.sourceId,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

// ----- Public ------------------------------------------------------------

router.get("/videos", async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag : null;
  const pageSize = Math.min(
    50,
    Math.max(1, Number(req.query.pageSize) || 12),
  );
  const page = Math.max(1, Number(req.query.page) || 1);

  const whereClauses = [
    eq(videosTable.active, true),
    eq(videosTable.status, "published"),
    sql`${videosTable.deletedAt} is null`,
  ];
  if (category && (VIDEO_CATEGORIES as readonly string[]).includes(category)) {
    whereClauses.push(eq(videosTable.category, category as (typeof VIDEO_CATEGORIES)[number]));
  }
  if (tag) {
    whereClauses.push(sql`${videosTable.tags} ? ${tag}`);
  }
  if (q) {
    const pattern = `%${q}%`;
    whereClauses.push(
      sql`(${videosTable.title} ilike ${pattern} or ${videosTable.shortDescription} ilike ${pattern})`,
    );
  }

  const whereExpr = and(...whereClauses);

  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(videosTable)
    .where(whereExpr);

  const rows = await db
    .select()
    .from(videosTable)
    .where(whereExpr)
    .orderBy(
      desc(videosTable.featured),
      sql`${videosTable.featuredRank} asc nulls last`,
      desc(videosTable.publishedAt),
      desc(videosTable.recordedAt),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({
    total: countRow?.count ?? 0,
    page,
    pageSize,
    items: rows.map(serialize),
  });
});

router.get("/videos/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.videosTable.findFirst({
    where: and(
      eq(videosTable.slug, slug),
      eq(videosTable.active, true),
      eq(videosTable.status, "published"),
    ),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ----- Admin -------------------------------------------------------------

const VideoBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  category: z.enum(VIDEO_CATEGORIES).optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().nullish(),
  heroImage: z.string().optional(),
  heroImageAlt: z.string().nullish(),
  shortDescription: z.string().optional(),
  bodyHtml: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pillar: z.string().nullish(),
  recordedAt: z.string().nullish(),
  durationSeconds: z.number().int().nullish(),
  status: z.enum(VIDEO_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  featured: z.boolean().optional(),
  featuredRank: z.number().int().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  ogImage: z.string().nullish(),
  active: z.boolean().optional(),
  sourceId: z.string().nullish(),
});
const VideoPatch = VideoBody.partial();

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cms/videos", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(videosTable)
    .orderBy(desc(videosTable.publishedAt), desc(videosTable.createdAt));
  const visible = rows.filter((r) => !r.deletedAt);
  res.json({ items: visible.map(serialize) });
});

router.get("/cms/videos/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.videosTable.findFirst({ where: eq(videosTable.id, id) });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/videos", ...adminGuard, async (req, res) => {
  const parsed = VideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueVideoSlug(d.slug || d.title);
  const [row] = await db
    .insert(videosTable)
    .values({
      slug,
      title: d.title,
      category: d.category ?? "webinar",
      videoUrl: d.videoUrl ?? "",
      thumbnailUrl: d.thumbnailUrl ?? null,
      heroImage: d.heroImage ?? "",
      heroImageAlt: d.heroImageAlt ?? null,
      shortDescription: d.shortDescription ?? "",
      bodyHtml: d.bodyHtml ?? "",
      tags: d.tags ?? [],
      pillar: d.pillar ?? null,
      recordedAt: parseDate(d.recordedAt),
      durationSeconds: d.durationSeconds ?? null,
      status: d.status ?? "draft",
      publishedAt: parseDate(d.publishedAt),
      unpublishedAt: parseDate(d.unpublishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
      ogImage: d.ogImage ?? null,
      active: d.active ?? true,
      sourceId: d.sourceId ?? null,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "video.create",
    entity: "video",
    entityId: row.id,
  });
  try {
    await upsertCollateralFromVideo(row);
  } catch (err) {
    req.log.error({ err, videoId: row.id }, "Failed to sync collateral after video create");
  }
  res.status(201).json(serialize(row));
});

router.patch("/cms/videos/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.videosTable.findFirst({ where: eq(videosTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = VideoPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueVideoSlug(d.slug, id);
  }
  for (const k of [
    "title",
    "category",
    "videoUrl",
    "thumbnailUrl",
    "heroImage",
    "heroImageAlt",
    "shortDescription",
    "bodyHtml",
    "tags",
    "pillar",
    "durationSeconds",
    "status",
    "featured",
    "featuredRank",
    "seoTitle",
    "seoDescription",
    "ogImage",
    "active",
    "sourceId",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.recordedAt !== undefined) updates.recordedAt = parseDate(d.recordedAt);
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(videosTable)
    .set(updates)
    .where(eq(videosTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "video.update",
    entity: "video",
    entityId: id,
  });
  try {
    await upsertCollateralFromVideo(updated);
  } catch (err) {
    req.log.error({ err, videoId: updated.id }, "Failed to sync collateral after video update");
  }
  res.json(serialize(updated));
});

router.delete("/cms/videos/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.videosTable.findFirst({ where: eq(videosTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(videosTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(videosTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "video.delete",
    entity: "video",
    entityId: id,
  });
  try {
    await softDeleteCollateralForVideo(id);
  } catch (err) {
    req.log.error({ err, videoId: id }, "Failed to soft-delete collateral after video delete");
  }
  res.status(204).end();
});

router.post("/cms/videos/:id/sync-to-collateral", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.videosTable.findFirst({ where: eq(videosTable.id, id) });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await upsertCollateralFromVideo(row);
  res.json({ ok: true });
});

export default router;
