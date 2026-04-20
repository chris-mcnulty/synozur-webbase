import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import { db, collateralTable } from "@workspace/db";

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

export default router;
