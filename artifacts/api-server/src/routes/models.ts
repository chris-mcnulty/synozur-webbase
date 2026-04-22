import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  modelsTable,
  ARTIFACT_STATUSES,
  COLLATERAL_PILLARS,
  type Model,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import {
  upsertCollateralFromModel,
  softDeleteCollateralForModel,
} from "../lib/syncCollateral";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

async function ensureUniqueModelSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const found = await db.query.modelsTable.findFirst({
      where: excludeId
        ? and(eq(modelsTable.slug, slug), ne(modelsTable.id, excludeId))
        : eq(modelsTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(m: Model) {
  return {
    id: m.id,
    slug: m.slug,
    title: m.title,
    shortDescription: m.shortDescription,
    heroImage: m.heroImage,
    longDescriptionHtml: m.longDescriptionHtml,
    dimensionsHtml: m.dimensionsHtml,
    launchUrl: m.launchUrl,
    relatedInformation: m.relatedInformation,
    pillar: m.pillar,
    serviceId: m.serviceId,
    solutionId: m.solutionId,
    status: m.status,
    publishedAt: m.publishedAt ? m.publishedAt.toISOString() : null,
    unpublishedAt: m.unpublishedAt ? m.unpublishedAt.toISOString() : null,
    featured: m.featured,
    featuredRank: m.featuredRank,
    seoTitle: m.seoTitle,
    seoDescription: m.seoDescription,
    ogImage: m.ogImage,
    active: m.active,
    sourceId: m.sourceId,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ----- Public ------------------------------------------------------------

router.get("/models", async (req, res) => {
  const pillar =
    typeof req.query.pillar === "string" ? req.query.pillar : null;
  const whereClauses = [
    eq(modelsTable.active, true),
    eq(modelsTable.status, "published"),
    sql`${modelsTable.deletedAt} is null`,
    sql`(${modelsTable.publishedAt} is null or ${modelsTable.publishedAt} <= now())`,
    sql`(${modelsTable.unpublishedAt} is null or ${modelsTable.unpublishedAt} > now())`,
  ];
  if (pillar && (COLLATERAL_PILLARS as readonly string[]).includes(pillar)) {
    whereClauses.push(eq(modelsTable.pillar, pillar as (typeof COLLATERAL_PILLARS)[number]));
  }
  const rows = await db
    .select()
    .from(modelsTable)
    .where(and(...whereClauses))
    .orderBy(
      desc(modelsTable.featured),
      sql`${modelsTable.featuredRank} asc nulls last`,
      desc(modelsTable.publishedAt),
      desc(modelsTable.createdAt),
    );
  res.json({ items: rows.map(serialize) });
});

router.get("/models/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.modelsTable.findFirst({
    where: and(
      eq(modelsTable.slug, slug),
      eq(modelsTable.active, true),
      eq(modelsTable.status, "published"),
      sql`${modelsTable.deletedAt} is null`,
      sql`(${modelsTable.publishedAt} is null or ${modelsTable.publishedAt} <= now())`,
      sql`(${modelsTable.unpublishedAt} is null or ${modelsTable.unpublishedAt} > now())`,
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ----- Admin -------------------------------------------------------------

const RelatedItemSchema = z.object({
  label: z.string(),
  url: z.string(),
  kind: z.enum(["link", "white-paper", "video", "case-study"]).optional(),
});

const ModelBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  shortDescription: z.string().optional(),
  heroImage: z.string().optional(),
  longDescriptionHtml: z.string().optional(),
  dimensionsHtml: z.string().optional(),
  launchUrl: z.string().optional(),
  relatedInformation: z.array(RelatedItemSchema).optional(),
  pillar: z.enum(COLLATERAL_PILLARS).nullish(),
  serviceId: z.string().uuid().nullish(),
  solutionId: z.string().uuid().nullish(),
  status: z.enum(ARTIFACT_STATUSES).optional(),
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
const ModelPatch = ModelBody.partial();

router.get("/cms/models", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(modelsTable)
    .where(sql`${modelsTable.deletedAt} is null`)
    .orderBy(
      desc(modelsTable.publishedAt),
      desc(modelsTable.createdAt),
    );
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/models/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.modelsTable.findFirst({
    where: eq(modelsTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/models", ...adminGuard, async (req, res) => {
  const parsed = ModelBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueModelSlug(d.slug || d.title);
  const [row] = await db
    .insert(modelsTable)
    .values({
      slug,
      title: d.title,
      shortDescription: d.shortDescription ?? "",
      heroImage: d.heroImage ?? "",
      longDescriptionHtml: d.longDescriptionHtml ?? "",
      dimensionsHtml: d.dimensionsHtml ?? "",
      launchUrl: d.launchUrl ?? "",
      relatedInformation: d.relatedInformation ?? [],
      pillar: d.pillar ?? null,
      serviceId: d.serviceId ?? null,
      solutionId: d.solutionId ?? null,
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
    action: "model.create",
    entity: "model",
    entityId: row.id,
  });
  try {
    await upsertCollateralFromModel(row);
  } catch (err) {
    req.log.error(
      { err, modelId: row.id },
      "Failed to sync collateral after model create",
    );
  }
  res.status(201).json(serialize(row));
});

router.patch("/cms/models/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.modelsTable.findFirst({
    where: eq(modelsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ModelPatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueModelSlug(d.slug, id);
  }
  for (const k of [
    "title",
    "shortDescription",
    "heroImage",
    "longDescriptionHtml",
    "dimensionsHtml",
    "launchUrl",
    "relatedInformation",
    "pillar",
    "serviceId",
    "solutionId",
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
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined)
    updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(modelsTable)
    .set(updates)
    .where(eq(modelsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "model.update",
    entity: "model",
    entityId: id,
  });
  try {
    await upsertCollateralFromModel(updated);
  } catch (err) {
    req.log.error(
      { err, modelId: updated.id },
      "Failed to sync collateral after model update",
    );
  }
  res.json(serialize(updated));
});

router.delete("/cms/models/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.modelsTable.findFirst({
    where: eq(modelsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(modelsTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(modelsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "model.delete",
    entity: "model",
    entityId: id,
  });
  try {
    await softDeleteCollateralForModel(id);
  } catch (err) {
    req.log.error(
      { err, modelId: id },
      "Failed to soft-delete collateral after model delete",
    );
  }
  res.status(204).end();
});

router.post(
  "/cms/models/:id/sync-to-collateral",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const row = await db.query.modelsTable.findFirst({
      where: eq(modelsTable.id, id),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await upsertCollateralFromModel(row);
    res.json({ ok: true });
  },
);

export default router;
