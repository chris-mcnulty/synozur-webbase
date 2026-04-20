import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, ne, inArray, sql } from "drizzle-orm";
import { db, collateralTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

const COLLATERAL_TYPES = [
  "webinar",
  "white_paper",
  "case_study",
  "podcast",
  "model",
  "training",
  "event",
  "insight",
] as const;

const COLLATERAL_PILLARS = ["strategic", "technology", "experiences", "gtm"] as const;

const ListQuery = z.object({
  type: z.string().optional(),
  pillar: z.string().optional(),
  topic: z.string().optional(),
  q: z.string().optional(),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

function serializeItem(row: typeof collateralTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    description: row.description,
    heroImage: row.heroImage,
    pillar: row.pillar ?? undefined,
    tags: (row.tags as string[]) ?? [],
    url: row.url,
    external: row.external,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString().split("T")[0] : "",
    featured: row.featured,
    featuredRank: row.featuredRank ?? undefined,
    videoUrl: row.videoUrl ?? undefined,
    downloadUrl: row.downloadUrl ?? undefined,
  };
}

function serializeAdminItem(row: typeof collateralTable.$inferSelect) {
  return {
    ...serializeItem(row),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/collateral/featured", async (_req, res) => {
  const rows = await db
    .select()
    .from(collateralTable)
    .where(
      and(
        isNull(collateralTable.deletedAt),
        eq(collateralTable.active, true),
        eq(collateralTable.featured, true),
      ),
    )
    .orderBy(
      sql`${collateralTable.featuredRank} asc nulls last`,
      desc(collateralTable.publishedAt),
    );

  res.json(rows.map(serializeItem));
});

router.get("/collateral", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { type, pillar, topic, q, featured, page, pageSize } = parsed.data;

  const types = type
    ? (type
        .split(",")
        .map((t) => t.trim())
        .filter((t) => (COLLATERAL_TYPES as readonly string[]).includes(t)) as (typeof COLLATERAL_TYPES)[number][])
    : [];
  const pillars = pillar
    ? (pillar
        .split(",")
        .map((p) => p.trim())
        .filter((p) => (COLLATERAL_PILLARS as readonly string[]).includes(p)) as (typeof COLLATERAL_PILLARS)[number][])
    : [];

  const filters = [isNull(collateralTable.deletedAt), eq(collateralTable.active, true)];

  if (types.length) filters.push(inArray(collateralTable.type, types));
  if (pillars.length) filters.push(inArray(collateralTable.pillar, pillars));
  if (featured) filters.push(eq(collateralTable.featured, true));
  if (topic && topic.trim()) {
    const needle = `%${topic.trim().toLowerCase()}%`;
    filters.push(
      sql`exists (select 1 from jsonb_array_elements_text(${collateralTable.tags}) as elem where lower(elem) like ${needle})`,
    );
  }
  if (q && q.trim()) {
    const needle = `%${q.trim().toLowerCase()}%`;
    filters.push(
      sql`(
        lower(${collateralTable.title}) like ${needle}
        or lower(coalesce(${collateralTable.subtitle}, '')) like ${needle}
        or lower(${collateralTable.description}) like ${needle}
        or exists (select 1 from jsonb_array_elements_text(${collateralTable.tags}) as elem where lower(elem) like ${needle})
      )`,
    );
  }

  const where = and(...filters);
  const offset = (page - 1) * pageSize;

  const orderBy = featured
    ? [sql`${collateralTable.featuredRank} asc nulls last`, desc(collateralTable.publishedAt)]
    : [desc(collateralTable.publishedAt)];

  const [rows, totalRow] = await Promise.all([
    db.select().from(collateralTable).where(where).orderBy(...orderBy).limit(pageSize).offset(offset),
    db.select({ c: sql<number>`count(*)::int` }).from(collateralTable).where(where),
  ]);

  res.json({
    items: rows.map(serializeItem),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  });
});

router.get("/collateral/:slug", async (req, res) => {
  const row = await db.query.collateralTable.findFirst({
    where: and(
      eq(collateralTable.slug, String(req.params.slug)),
      isNull(collateralTable.deletedAt),
      eq(collateralTable.active, true),
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeItem(row));
});

// ----- Admin -------------------------------------------------------------

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.collateralTable.findFirst({
      where: excludeId
        ? and(eq(collateralTable.slug, slug), ne(collateralTable.id, excludeId))
        : eq(collateralTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

const CollateralBody = z.object({
  slug: z.string().nullish(),
  type: z.enum(COLLATERAL_TYPES),
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  description: z.string().optional().default(""),
  heroImage: z.string().optional().default(""),
  pillar: z.enum(COLLATERAL_PILLARS).nullish(),
  tags: z.array(z.string()).optional().default([]),
  url: z.string().optional().default(""),
  external: z.boolean().optional().default(false),
  publishedAt: z.string().nullish(),
  featured: z.boolean().optional().default(false),
  featuredRank: z.number().int().nullish(),
  videoUrl: z.string().nullish(),
  downloadUrl: z.string().nullish(),
  active: z.boolean().optional(),
});

const CollateralPatch = CollateralBody.partial();

function parseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

router.get("/cms/collateral", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(collateralTable)
    .where(isNull(collateralTable.deletedAt))
    .orderBy(
      sql`${collateralTable.featured} desc`,
      sql`${collateralTable.featuredRank} asc nulls last`,
      desc(collateralTable.publishedAt),
      asc(collateralTable.title),
    );
  res.json({ items: rows.map(serializeAdminItem) });
});

router.get("/cms/collateral/:id", ...readGuard, async (req, res) => {
  const row = await db.query.collateralTable.findFirst({
    where: and(eq(collateralTable.id, String(req.params.id)), isNull(collateralTable.deletedAt)),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serializeAdminItem(row));
});

router.post("/cms/collateral", ...adminGuard, async (req, res) => {
  const parsed = CollateralBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(d.slug || d.title);
  const [row] = await db
    .insert(collateralTable)
    .values({
      slug,
      type: d.type,
      title: d.title,
      subtitle: d.subtitle ?? null,
      description: d.description ?? "",
      heroImage: d.heroImage ?? "",
      pillar: d.pillar ?? null,
      tags: d.tags ?? [],
      url: d.url ?? "",
      external: d.external ?? false,
      publishedAt: parseDate(d.publishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      videoUrl: d.videoUrl ?? null,
      downloadUrl: d.downloadUrl ?? null,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.create",
    entity: "collateral",
    entityId: row.id,
  });
  res.status(201).json(serializeAdminItem(row));
});

router.patch("/cms/collateral/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = CollateralPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null && d.slug !== existing.slug) {
    updates.slug = await ensureUniqueSlug(d.slug, id);
  }
  if (d.type !== undefined) updates.type = d.type;
  if (d.title !== undefined) updates.title = d.title;
  if (d.subtitle !== undefined) updates.subtitle = d.subtitle;
  if (d.description !== undefined) updates.description = d.description ?? "";
  if (d.heroImage !== undefined) updates.heroImage = d.heroImage ?? "";
  if (d.pillar !== undefined) updates.pillar = d.pillar;
  if (d.tags !== undefined) updates.tags = d.tags ?? [];
  if (d.url !== undefined) updates.url = d.url ?? "";
  if (d.external !== undefined) updates.external = d.external;
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.featured !== undefined) updates.featured = d.featured;
  if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank;
  if (d.videoUrl !== undefined) updates.videoUrl = d.videoUrl;
  if (d.downloadUrl !== undefined) updates.downloadUrl = d.downloadUrl;
  if (d.active !== undefined) updates.active = d.active;

  const [updated] = await db
    .update(collateralTable)
    .set(updates)
    .where(eq(collateralTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.update",
    entity: "collateral",
    entityId: id,
  });
  res.json(serializeAdminItem(updated));
});

const ReorderBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "ids must contain unique values",
    }),
});

router.post("/cms/collateral/reorder", ...adminGuard, async (req, res) => {
  const parsed = ReorderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { ids } = parsed.data;

  const rows = await db
    .select({ id: collateralTable.id, featured: collateralTable.featured })
    .from(collateralTable)
    .where(and(inArray(collateralTable.id, ids), isNull(collateralTable.deletedAt)));
  const known = new Map(rows.map((r) => [r.id, r.featured]));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) {
    res.status(400).json({ error: "Unknown collateral ids", missing });
    return;
  }
  const notFeatured = ids.filter((id) => known.get(id) !== true);
  if (notFeatured.length) {
    res
      .status(400)
      .json({ error: "Only featured items may be reordered", nonFeatured: notFeatured });
    return;
  }

  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(collateralTable)
        .set({ featuredRank: i + 1, updatedAt })
        .where(eq(collateralTable.id, ids[i]));
    }
  });

  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.reorder",
    entity: "collateral",
    entityId: ids.join(","),
  });

  res.json({ updated: ids.length });
});

router.delete("/cms/collateral/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(collateralTable)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(collateralTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.delete",
    entity: "collateral",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
