import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ne, sql, inArray } from "drizzle-orm";
import {
  db,
  whitePapersTable,
  assetsTable,
  mediaTable,
  WHITE_PAPER_DOC_TYPES,
  WHITE_PAPER_STATUSES,
  type WhitePaper,
  type Asset,
  type Media,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import { isGone, sendGone } from "../lib/goneResponse";
import { submitIfTransitionedToGone } from "../lib/seoUnpublishSubmit";
import { reindexEditorialSourceSafe } from "../lib/ai/reindexHook";
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

function assetStorageUrl(asset: Asset): string {
  return `/api/storage${asset.storageKey}`;
}

function mediaStorageUrl(media: Media): string {
  return media.publicUrl || `/api/storage${media.storageKey}`;
}

const ALLOWED_DOCUMENT_MIME_PATTERNS: readonly RegExp[] = [
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/vnd\.ms-(powerpoint|excel)$/,
  /^application\/(zip|x-zip-compressed)$/,
  /^text\/(plain|csv)$/,
];

function isAllowedDocumentMime(mime: string): boolean {
  return ALLOWED_DOCUMENT_MIME_PATTERNS.some((re) => re.test(mime));
}

function serializeDocumentAsset(asset: Asset) {
  return {
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.size,
    storageKey: asset.storageKey,
  };
}

// New uploads through MediaPickerModal store a `documentMediaId` UUID; the
// editor surfaces the file using this serializer instead of the legacy asset
// shape so the existing `documentAsset` UI keeps working without a special
// case for media-backed uploads.
function serializeDocumentMedia(media: Media) {
  return {
    id: -1,
    originalName: media.originalName ?? media.altText ?? media.storageKey,
    mimeType: media.mime ?? "application/octet-stream",
    size: media.byteSize ?? 0,
    storageKey: media.storageKey,
  };
}

function serialize(
  w: WhitePaper,
  documentAsset: Asset | null = null,
  documentMedia: Media | null = null,
) {
  const resolvedDocumentUrl = documentMedia
    ? mediaStorageUrl(documentMedia)
    : documentAsset
      ? assetStorageUrl(documentAsset)
      : w.documentUrl;
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
    documentUrl: resolvedDocumentUrl,
    documentAssetId: w.documentAssetId,
    documentMediaId: w.documentMediaId,
    documentAsset: documentMedia
      ? serializeDocumentMedia(documentMedia)
      : documentAsset
        ? serializeDocumentAsset(documentAsset)
        : null,
    serviceId: w.serviceId ?? null,
    solutionId: w.solutionId ?? null,
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

async function loadDocumentAsset(
  documentAssetId: number | null | undefined,
): Promise<Asset | null> {
  if (!documentAssetId) return null;
  const [asset] = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.id, documentAssetId));
  return asset ?? null;
}

async function loadDocumentMedia(
  documentMediaId: string | null | undefined,
): Promise<Media | null> {
  if (!documentMediaId) return null;
  const [media] = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.id, documentMediaId));
  return media ?? null;
}

async function loadDocumentAssetsByIds(
  rows: WhitePaper[],
): Promise<Map<number, Asset>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.documentAssetId).filter((v): v is number => v != null)),
  );
  if (!ids.length) return new Map();
  const assets = await db.select().from(assetsTable).where(inArray(assetsTable.id, ids));
  return new Map(assets.map((a) => [a.id, a]));
}

async function loadDocumentMediaByIds(
  rows: WhitePaper[],
): Promise<Map<string, Media>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.documentMediaId).filter((v): v is string => v != null)),
  );
  if (!ids.length) return new Map();
  const mediaRows = await db.select().from(mediaTable).where(inArray(mediaTable.id, ids));
  return new Map(mediaRows.map((m) => [m.id, m]));
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

  const [assetsById, mediaById] = await Promise.all([
    loadDocumentAssetsByIds(rows),
    loadDocumentMediaByIds(rows),
  ]);
  res.json({
    total: countRow?.count ?? 0,
    page,
    pageSize,
    items: rows.map((r) =>
      serialize(
        r,
        r.documentAssetId ? assetsById.get(r.documentAssetId) ?? null : null,
        r.documentMediaId ? mediaById.get(r.documentMediaId) ?? null : null,
      ),
    ),
  });
});

router.get("/white-papers/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const now = new Date();
  const row = await db.query.whitePapersTable.findFirst({
    where: and(
      eq(whitePapersTable.slug, slug),
      sql`${whitePapersTable.deletedAt} is null`,
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // #162: archived or past-unpublishedAt returns 410 Gone for prompt de-indexing.
  if (isGone(row, now)) {
    sendGone(res, "white paper");
    return;
  }
  if (
    !row.active ||
    row.status !== "published" ||
    (row.publishedAt && row.publishedAt > now)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [documentAsset, documentMedia] = await Promise.all([
    loadDocumentAsset(row.documentAssetId),
    loadDocumentMedia(row.documentMediaId),
  ]);
  res.json(serialize(row, documentAsset, documentMedia));
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
  documentAssetId: z.number().int().nullish(),
  documentMediaId: z.string().uuid().nullish(),
  serviceId: z.string().uuid().nullish(),
  solutionId: z.string().uuid().nullish(),
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
    .where(sql`${whitePapersTable.deletedAt} IS NULL`)
    .orderBy(desc(whitePapersTable.publishedAt), desc(whitePapersTable.createdAt));
  const [assetsById, mediaById] = await Promise.all([
    loadDocumentAssetsByIds(rows),
    loadDocumentMediaByIds(rows),
  ]);
  res.json({
    items: rows.map((r) =>
      serialize(
        r,
        r.documentAssetId ? assetsById.get(r.documentAssetId) ?? null : null,
        r.documentMediaId ? mediaById.get(r.documentMediaId) ?? null : null,
      ),
    ),
  });
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
  const [documentAsset, documentMedia] = await Promise.all([
    loadDocumentAsset(row.documentAssetId),
    loadDocumentMedia(row.documentMediaId),
  ]);
  res.json(serialize(row, documentAsset, documentMedia));
});

router.post("/cms/white-papers", ...adminGuard, async (req, res) => {
  const parsed = WhitePaperBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (d.documentAssetId != null) {
    const [docAsset] = await db
      .select()
      .from(assetsTable)
      .where(eq(assetsTable.id, d.documentAssetId));
    if (!docAsset) {
      res.status(400).json({ error: "documentAssetId references a non-existent asset" });
      return;
    }
    if (!isAllowedDocumentMime(docAsset.mimeType)) {
      res.status(400).json({ error: `Asset MIME type '${docAsset.mimeType}' is not an allowed document type` });
      return;
    }
  }
  if (d.documentMediaId != null) {
    const [docMedia] = await db
      .select()
      .from(mediaTable)
      .where(eq(mediaTable.id, d.documentMediaId));
    if (!docMedia) {
      res.status(400).json({ error: "documentMediaId references a non-existent media row" });
      return;
    }
    if (docMedia.mime && !isAllowedDocumentMime(docMedia.mime)) {
      res.status(400).json({
        error: `Media MIME type '${docMedia.mime}' is not an allowed document type`,
      });
      return;
    }
  }
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
      documentAssetId: d.documentAssetId ?? null,
      documentMediaId: d.documentMediaId ?? null,
      serviceId: d.serviceId ?? null,
      solutionId: d.solutionId ?? null,
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
  await reindexEditorialSourceSafe("white_paper", row.id, req.log);
  const [documentAsset, documentMedia] = await Promise.all([
    loadDocumentAsset(row.documentAssetId),
    loadDocumentMedia(row.documentMediaId),
  ]);
  res.status(201).json(serialize(row, documentAsset, documentMedia));
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
  if (d.documentAssetId != null) {
    const [docAsset] = await db
      .select()
      .from(assetsTable)
      .where(eq(assetsTable.id, d.documentAssetId));
    if (!docAsset) {
      res.status(400).json({ error: "documentAssetId references a non-existent asset" });
      return;
    }
    if (!isAllowedDocumentMime(docAsset.mimeType)) {
      res.status(400).json({ error: `Asset MIME type '${docAsset.mimeType}' is not an allowed document type` });
      return;
    }
  }
  if (d.documentMediaId != null) {
    const [docMedia] = await db
      .select()
      .from(mediaTable)
      .where(eq(mediaTable.id, d.documentMediaId));
    if (!docMedia) {
      res.status(400).json({ error: "documentMediaId references a non-existent media row" });
      return;
    }
    if (docMedia.mime && !isAllowedDocumentMime(docMedia.mime)) {
      res.status(400).json({
        error: `Media MIME type '${docMedia.mime}' is not an allowed document type`,
      });
      return;
    }
  }
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
    "documentAssetId",
    "documentMediaId",
    "serviceId",
    "solutionId",
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
  // #254: ping search engines if this save flipped the row into a "gone" state.
  await submitIfTransitionedToGone({
    entityType: "white_paper",
    entityId: id,
    slug: existing.slug,
    publicPath: `/library/${existing.slug}`,
    alsoSubmitPath:
      updated.slug !== existing.slug ? `/library/${updated.slug}` : undefined,
    before: existing,
    after: updated,
    log: req.log,
  });
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
  await reindexEditorialSourceSafe("white_paper", id, req.log);
  const [documentAsset, documentMedia] = await Promise.all([
    loadDocumentAsset(updated.documentAssetId),
    loadDocumentMedia(updated.documentMediaId),
  ]);
  res.json(serialize(updated, documentAsset, documentMedia));
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
  // #254: soft-delete (active=false) returns 404 Not Found for white papers,
  // not 410 Gone, so we deliberately do not submit a removal here. Use the
  // archive flow if you need search engines to drop the URL.
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
  await reindexEditorialSourceSafe("white_paper", id, req.log);
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
