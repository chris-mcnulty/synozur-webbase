import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, ne, inArray, sql } from "drizzle-orm";
import { db, collateralTable, COLLATERAL_TYPES } from "@workspace/db";
import {
  canonicalUrlForCollateral,
  isSyncedCollateralType,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

const COLLATERAL_PILLARS = ["strategic", "technology", "experiences", "gtm"] as const;

// Admin path for the dedicated editor of a synced content type. Returned to
// the admin UI so it can deep-link the user to the right editor when they
// try to manage typed content via the generic collateral admin.
function editorPathForSyncedType(type: string): string {
  switch (type) {
    case "white_paper":
    case "ebook":
      return "/library/white-papers";
    case "case_study":
      return "/products/case-studies";
    case "model":
      return "/products/models";
    case "video":
      return "/library/videos";
    case "event":
      return "/events";
    case "insight":
      return "/insights/posts";
    case "podcast":
      return "/library/polaris-episodes";
    default:
      return "/library/collateral";
  }
}

// Fields safe to edit on a synced collateral row directly. These are
// presentation/curation properties owned by the library admin, not content
// owned by the source-of-truth table. Everything else must be edited at
// the source.
const SYNCED_ROW_EDITABLE_FIELDS = new Set([
  "featured",
  "featuredRank",
  "active",
  "serviceId",
  "solutionId",
] as const);

const ListQuery = z.object({
  type: z.string().optional(),
  pillar: z.string().optional(),
  topic: z.string().optional(),
  q: z.string().optional(),
  serviceId: z.string().uuid().optional(),
  solutionId: z.string().uuid().optional(),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

// #121: admin-list sort spec. Single "field:dir" tuple (e.g. "title:asc") —
// multi-column not needed yet but the parser accepts comma-separated tuples
// so the frontend can grow without a schema change. Unknown fields are
// silently skipped; callers that want strict validation should pre-check
// their sort string.
const SortableCmsCollateralColumns = {
  title: collateralTable.title,
  type: collateralTable.type,
  pillar: collateralTable.pillar,
  publishedAt: collateralTable.publishedAt,
  updatedAt: collateralTable.updatedAt,
  createdAt: collateralTable.createdAt,
  featured: collateralTable.featured,
  featuredRank: collateralTable.featuredRank,
} as const;

type SortableCmsCollateralColumn = keyof typeof SortableCmsCollateralColumns;

const ListCmsQuery = z.object({
  sort: z.string().optional(),
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
    serviceId: row.serviceId ?? undefined,
    solutionId: row.solutionId ?? undefined,
    polarisEpisodeId: row.polarisEpisodeId ?? undefined,
  };
}

function serializeAdminItem(row: typeof collateralTable.$inferSelect) {
  return {
    ...serializeItem(row),
    active: row.active,
    // sourceId distinguishes synced rows (mirrored from a source-of-truth
    // table like white_papers) from purely standalone collateral rows. The
    // admin UI uses this to redirect content edits to the source editor.
    sourceId: row.sourceId ?? null,
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
  const { type, pillar, topic, q, serviceId, solutionId, featured, page, pageSize } = parsed.data;

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
  if (serviceId) filters.push(eq(collateralTable.serviceId, serviceId));
  if (solutionId) filters.push(eq(collateralTable.solutionId, solutionId));
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
  const slugLower = String(req.params.slug).toLowerCase();
  const row = await db.query.collateralTable.findFirst({
    where: and(
      sql`lower(${collateralTable.slug}) = ${slugLower}`,
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
  serviceId: z.string().uuid().nullish(),
  solutionId: z.string().uuid().nullish(),
  active: z.boolean().optional(),
});

const CollateralPatch = CollateralBody.partial();

function parseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

router.get("/cms/collateral", ...readGuard, async (req, res) => {
  const parsed = ListCmsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { sort } = parsed.data;

  const orderBy = parseCmsCollateralSort(sort);

  const rows = await db
    .select()
    .from(collateralTable)
    .where(isNull(collateralTable.deletedAt))
    .orderBy(...orderBy);
  res.json({ items: rows.map(serializeAdminItem) });
});

function parseCmsCollateralSort(sort: string | undefined) {
  const defaultOrder = [
    sql`${collateralTable.featured} desc`,
    sql`${collateralTable.featuredRank} asc nulls last`,
    desc(collateralTable.publishedAt),
    asc(collateralTable.title),
  ];
  if (!sort) return defaultOrder;

  const clauses = [];
  let titleIncluded = false;
  for (const part of sort.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [rawCol, rawDir] = part.split(":").map((s) => s.trim());
    const column =
      SortableCmsCollateralColumns[rawCol as SortableCmsCollateralColumn];
    if (!column) continue;
    if (rawCol === "title") titleIncluded = true;
    const dir = rawDir?.toLowerCase() === "desc" ? "desc" : "asc";
    // `pillar` and `featuredRank` are nullable — send NULLs to the end for
    // both directions so the "sorted" view stays coherent for editors.
    const nullable = rawCol === "pillar" || rawCol === "featuredRank";
    if (nullable) {
      clauses.push(
        dir === "desc"
          ? sql`${column} desc nulls last`
          : sql`${column} asc nulls last`,
      );
    } else {
      clauses.push(dir === "desc" ? desc(column) : asc(column));
    }
  }

  // Always append title asc as a stable tiebreaker when callers sort on a
  // non-title column; prevents flicker between requests with the same key.
  if (clauses.length > 0 && !titleIncluded) {
    clauses.push(asc(collateralTable.title));
  }

  return clauses.length > 0 ? clauses : defaultOrder;
}

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
  // Block direct creation of types that have a dedicated source-of-truth
  // table. Editors must use the type-specific admin (e.g. /library/white-papers)
  // so the canonical record exists and the upsertCollateralFromX sync runs.
  if (isSyncedCollateralType(d.type)) {
    res.status(400).json({
      error: "Use the dedicated editor for this content type",
      details: {
        type: d.type,
        editorPath: editorPathForSyncedType(d.type),
      },
    });
    return;
  }
  const slug = await ensureUniqueSlug(d.slug || d.title);
  // Derive url server-side from type+slug. Client-supplied url is ignored to
  // prevent regressions like the legacy /items/<slug> pattern that 404s.
  const derivedUrl = canonicalUrlForCollateral(d.type, slug);
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
      url: d.external && d.url ? d.url : derivedUrl,
      external: d.external ?? false,
      publishedAt: parseDate(d.publishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      videoUrl: d.videoUrl ?? null,
      downloadUrl: d.downloadUrl ?? null,
      serviceId: d.serviceId ?? null,
      solutionId: d.solutionId ?? null,
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

  // Synced rows (sourceId set) are mirrors of a source-of-truth table.
  // Reject edits to content fields — those must be made at the source so
  // the next sync doesn't overwrite them. Curation fields (featured,
  // featuredRank, active, service/solution links) remain editable here.
  if (existing.sourceId) {
    const supplied = Object.entries(d).filter(([, v]) => v !== undefined);
    const disallowed = supplied
      .map(([k]) => k)
      .filter((k) => !SYNCED_ROW_EDITABLE_FIELDS.has(k as never));
    if (disallowed.length > 0) {
      res.status(400).json({
        error: "Edit content at the source",
        details: {
          sourceId: existing.sourceId,
          disallowedFields: disallowed,
          editorPath: editorPathForSyncedType(existing.type),
        },
      });
      return;
    }
    if (d.featured !== undefined) updates.featured = d.featured;
    if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank;
    if (d.active !== undefined) updates.active = d.active;
    if (d.serviceId !== undefined) updates.serviceId = d.serviceId;
    if (d.solutionId !== undefined) updates.solutionId = d.solutionId;
  } else {
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
    if (d.external !== undefined) updates.external = d.external;
    if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
    if (d.featured !== undefined) updates.featured = d.featured;
    if (d.featuredRank !== undefined) updates.featuredRank = d.featuredRank;
    if (d.videoUrl !== undefined) updates.videoUrl = d.videoUrl;
    if (d.downloadUrl !== undefined) updates.downloadUrl = d.downloadUrl;
    if (d.serviceId !== undefined) updates.serviceId = d.serviceId;
    if (d.solutionId !== undefined) updates.solutionId = d.solutionId;
    if (d.active !== undefined) updates.active = d.active;

    // Re-derive url whenever slug or type changes. For external rows the
    // client url is preserved (those point at off-site resources). Client
    // url is otherwise ignored to prevent /items/<slug> regressions.
    const nextSlug = (updates.slug as string | undefined) ?? existing.slug;
    const nextType = (updates.type as string | undefined) ?? existing.type;
    const nextExternal = (updates.external as boolean | undefined) ?? existing.external;
    if (nextExternal && d.url !== undefined) {
      updates.url = d.url ?? "";
    } else {
      updates.url = canonicalUrlForCollateral(nextType, nextSlug);
    }
  }

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
  const featuredRankCase = sql<number>`case ${sql.join(
    ids.map((id, index) => sql`when ${collateralTable.id} = ${id} then ${index + 1}`),
    sql` `,
  )} end`;
  await db.transaction(async (tx) => {
    await tx
      .update(collateralTable)
      .set({ featuredRank: featuredRankCase, updatedAt })
      .where(inArray(collateralTable.id, ids));
  });

  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.reorder",
    entity: "collateral",
    entityId: ids.join(","),
  });

  res.json({ updated: ids.length });
});

// Bulk edit — apply one or more field changes to a set of collateral rows.
// Fields on `set` are three-state: missing = leave alone, null = clear,
// value = assign. Tags use a separate `tagsAction` so callers can add or
// remove without clobbering existing tags.
const BulkBody = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "ids must contain unique values",
      }),
    set: z
      .object({
        serviceId: z.string().uuid().nullable().optional(),
        solutionId: z.string().uuid().nullable().optional(),
        pillar: z.enum(COLLATERAL_PILLARS).nullable().optional(),
        type: z.enum(COLLATERAL_TYPES).optional(),
        active: z.boolean().optional(),
        featured: z.boolean().optional(),
      })
      .optional(),
    tagsAction: z
      .object({
        mode: z.enum(["add", "remove", "replace"]),
        tags: z.array(z.string().min(1)).max(50),
      })
      .optional(),
  })
  .refine((b) => !!b.set || !!b.tagsAction, {
    message: "Provide at least one of `set` or `tagsAction`",
  });

router.post("/cms/collateral/bulk", ...adminGuard, async (req, res) => {
  const parsed = BulkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { ids, set, tagsAction } = parsed.data;

  const existing = await db
    .select({ id: collateralTable.id, tags: collateralTable.tags })
    .from(collateralTable)
    .where(and(inArray(collateralTable.id, ids), isNull(collateralTable.deletedAt)));
  const knownIds = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) {
    res.status(400).json({ error: "Unknown collateral ids", missing });
    return;
  }

  const now = new Date();
  const commonUpdates: Record<string, unknown> = { updatedAt: now };
  if (set) {
    if (set.serviceId !== undefined) commonUpdates.serviceId = set.serviceId;
    if (set.solutionId !== undefined) commonUpdates.solutionId = set.solutionId;
    if (set.pillar !== undefined) commonUpdates.pillar = set.pillar;
    if (set.type !== undefined) commonUpdates.type = set.type;
    if (set.active !== undefined) commonUpdates.active = set.active;
    if (set.featured !== undefined) commonUpdates.featured = set.featured;
  }

  const hasCommonUpdates = Object.keys(commonUpdates).length > 1;
  let updatedCount = hasCommonUpdates || tagsAction?.mode === "replace" ? ids.length : 0;

  await db.transaction(async (tx) => {
    if (hasCommonUpdates) {
      await tx
        .update(collateralTable)
        .set(commonUpdates)
        .where(inArray(collateralTable.id, ids));
    }
    if (tagsAction) {
      if (tagsAction.mode === "replace") {
        await tx
          .update(collateralTable)
          .set({ tags: tagsAction.tags, updatedAt: now })
          .where(inArray(collateralTable.id, ids));
      } else {
        // Add/remove need per-row merge since jsonb arrays can differ per row.
        for (const row of existing) {
          const current = (row.tags as string[] | null) ?? [];
          const next =
            tagsAction.mode === "add"
              ? Array.from(new Set([...current, ...tagsAction.tags]))
              : current.filter((t) => !tagsAction.tags.includes(t));
          // Skip write if unchanged to avoid pointless updatedAt churn.
          if (
            next.length === current.length &&
            next.every((t, i) => t === current[i])
          ) {
            continue;
          }
          await tx
            .update(collateralTable)
            .set({ tags: next, updatedAt: now })
            .where(eq(collateralTable.id, row.id));
          if (!hasCommonUpdates) {
            updatedCount += 1;
          }
        }
      }
    }
  });

  await audit({
    actorId: req.authedUser!.id,
    action: "collateral.bulk_update",
    entity: "collateral",
    entityId: ids.join(","),
  });

  res.json({ updated: updatedCount });
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
