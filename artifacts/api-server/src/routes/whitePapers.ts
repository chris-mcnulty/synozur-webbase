import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ne, asc, sql } from "drizzle-orm";
import {
  db,
  whitePapersTable,
  WHITE_PAPER_DOC_TYPES,
  WHITE_PAPER_STATUSES,
  type WhitePaper,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import {
  upsertCollateralFromWhitePaper,
  softDeleteCollateralForWhitePaper,
} from "../lib/syncCollateral";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

async function ensureUniqueWhitePaperSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.whitePapersTable.findFirst({
      where: excludeId
        ? and(eq(whitePapersTable.slug, slug), ne(whitePapersTable.id, excludeId))
        : eq(whitePapersTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(w: WhitePaper) {
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    subtitle: w.subtitle,
    docType: w.docType,
    heroImage: w.heroImage,
    heroImageAlt: w.heroImageAlt,
    shortDescription: w.shortDescription,
    bodyHtml: w.bodyHtml,
    tags: w.tags,
    pillar: w.pillar,
    documentUrl: w.documentUrl,
    externalUrl: w.externalUrl,
    pageCount: w.pageCount,
    status: w.status,
    publishedAt: w.publishedAt,
    unpublishedAt: w.unpublishedAt,
    featured: w.featured,
    featuredRank: w.featuredRank,
    seoTitle: w.seoTitle,
    seoDescription: w.seoDescription,
    ogImage: w.ogImage,
    active: w.active,
    sourceId: w.sourceId,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

// ----- Public ------------------------------------------------------------

router.get("/white-papers", async (req, res) => {
  const docType = typeof req.query.docType === "string" ? req.query.docType : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag : null;
  const pageSize = Math.min(
    50,
    Math.max(1, Number(req.query.pageSize) || 12),
  );
  const page = Math.max(1, Number(req.query.page) || 1);

  const whereClauses = [
    eq(whitePapersTable.active, true),
    eq(whitePapersTable.status, "published"),
    sql`${whitePapersTable.deletedAt} is null`,
    sql`${whitePapersTable.publishedAt} <= now()`,
    sql`(${whitePapersTable.unpublishedAt} is null or ${whitePapersTable.unpublishedAt} > now())`,
  ];
  if (docType && (WHITE_PAPER_DOC_TYPES as readonly string[]).includes(docType)) {
    whereClauses.push(
      eq(whitePapersTable.docType, docType as (typeof WHITE_PAPER_DOC_TYPES)[number]),
    );
  }
  if (tag) {
    whereClauses.push(sql`${whitePapersTable.tags} ? ${tag}`);
  }
  if (q) {
    const pattern = `%${q}%`;
    whereClauses.push(
      sql`(${whitePapersTable.title} ilike ${pattern} or ${whitePapersTable.shortDescription} ilike ${pattern})`,
    );
  }

  const whereExpr = and(...whereClauses);

  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(whitePapersTable)
    .where(whereExpr);

  const rows = await db
    .select()
    .from(whitePapersTable)
    .where(whereExpr)
    .orderBy(
      desc(whitePapersTable.featured),
      sql`${whitePapersTable.featuredRank} asc nulls last`,
      desc(whitePapersTable.publishedAt),
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

router.get("/white-papers/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.whitePapersTable.findFirst({
    where: and(
      eq(whitePapersTable.slug, slug),
      eq(whitePapersTable.active, true),
      eq(whitePapersTable.status, "published"),
    ),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ----- Admin -------------------------------------------------------------

const WhitePaperBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  docType: z.enum(WHITE_PAPER_DOC_TYPES).optional(),
  heroImage: z.string().optional(),
  heroImageAlt: z.string().nullish(),
  shortDescription: z.string().optional(),
  bodyHtml: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pillar: z.string().nullish(),
  documentUrl: z.string().nullish(),
  externalUrl: z.string().nullish(),
  pageCount: z.number().int().nullish(),
  status: z.enum(WHITE_PAPER_STATUSES).optional(),
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
const WhitePaperPatch = WhitePaperBody.partial();

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cms/white-papers", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(whitePapersTable)
    .orderBy(desc(whitePapersTable.publishedAt), desc(whitePapersTable.createdAt));
  const visible = rows.filter((r) => !r.deletedAt);
  res.json({ items: visible.map(serialize) });
});

router.get("/cms/white-papers/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.whitePapersTable.findFirst({
    where: eq(whitePapersTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/white-papers", ...adminGuard, async (req, res) => {
  const parsed = WhitePaperBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueWhitePaperSlug(d.slug || d.title);
  const [row] = await db
    .insert(whitePapersTable)
    .values({
      slug,
      title: d.title,
      subtitle: d.subtitle ?? null,
      docType: d.docType ?? "whitepaper",
      heroImage: d.heroImage ?? "",
      heroImageAlt: d.heroImageAlt ?? null,
      shortDescription: d.shortDescription ?? "",
      bodyHtml: d.bodyHtml ?? "",
      tags: d.tags ?? [],
      pillar: d.pillar ?? null,
      documentUrl: d.documentUrl ?? null,
      externalUrl: d.externalUrl ?? null,
      pageCount: d.pageCount ?? null,
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
    action: "white_paper.create",
    entity: "white_paper",
    entityId: row.id,
  });
  try {
    await upsertCollateralFromWhitePaper(row);
  } catch (err) {
    req.log.error(
      { err, whitePaperId: row.id },
      "Failed to sync collateral after white paper create",
    );
  }
  res.status(201).json(serialize(row));
});

router.patch("/cms/white-papers/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.whitePapersTable.findFirst({
    where: eq(whitePapersTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = WhitePaperPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueWhitePaperSlug(d.slug, id);
  }
  for (const k of [
    "title",
    "subtitle",
    "docType",
    "heroImage",
    "heroImageAlt",
    "shortDescription",
    "bodyHtml",
    "tags",
    "pillar",
    "documentUrl",
    "externalUrl",
    "pageCount",
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
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(whitePapersTable)
    .set(updates)
    .where(eq(whitePapersTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "white_paper.update",
    entity: "white_paper",
    entityId: id,
  });
  try {
    await upsertCollateralFromWhitePaper(updated);
  } catch (err) {
    req.log.error(
      { err, whitePaperId: updated.id },
      "Failed to sync collateral after white paper update",
    );
  }
  res.json(serialize(updated));
});

router.delete("/cms/white-papers/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.whitePapersTable.findFirst({
    where: eq(whitePapersTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(whitePapersTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(whitePapersTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "white_paper.delete",
    entity: "white_paper",
    entityId: id,
  });
  try {
    await softDeleteCollateralForWhitePaper(id);
  } catch (err) {
    req.log.error(
      { err, whitePaperId: id },
      "Failed to soft-delete collateral after white paper delete",
    );
  }
  res.status(204).end();
});

router.post("/cms/white-papers/:id/sync-to-collateral", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.whitePapersTable.findFirst({
    where: eq(whitePapersTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await upsertCollateralFromWhitePaper(row);
  res.json({ ok: true });
});

export default router;
