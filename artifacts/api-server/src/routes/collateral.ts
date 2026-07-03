import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, ne, inArray, sql } from "drizzle-orm";
import {
  db,
  collateralTable,
  collateralSolutionsTable,
  solutionsTable,
  servicesTable,
  COLLATERAL_TYPES,
  whitePapersTable,
  caseStudiesTable,
  modelsTable,
  videosTable,
  postsTable,
  polarisEpisodesTable,
  eventsTable,
  landingPagesTable,
} from "@workspace/db";
import {
  canonicalUrlForCollateral,
  isSyncedCollateralType,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import { loadSerializedResourcesForCollateral } from "./collateralResources";

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
  solutionIdIsNull: z
    .string()
    .optional()
    .transform((v) => v === "true"),
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
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? null,
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
  const { type, pillar, topic, q, serviceId, solutionId, solutionIdIsNull, featured, page, pageSize } = parsed.data;

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
  if (solutionIdIsNull) filters.push(isNull(collateralTable.solutionId));
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
  // Inline resources on the by-slug response so the public detail page can
  // render the Resources section without a follow-up request. The list
  // endpoint deliberately omits this — the carousel/grid only needs the
  // first-CTA hint, which is mirrored to the legacy `downloadUrl` column.
  const resources = await loadSerializedResourcesForCollateral(row.id);
  res.json({ ...serializeItem(row), resources });
});

// ----- Admin -------------------------------------------------------------

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
   
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
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
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

// ----- Library Health ---------------------------------------------------
//
// GET /cms/collateral/library-health
//
// Returns active collateral items where BOTH description and seoDescription
// are empty/null. This surfaces the "no-description-at-all" backlog that
// the per-item warning in collateral-edit.tsx catches one at a time.
//
// Query params:
//   type   — comma-separated collateral type filter
//   sort   — "field:dir" (field: type|title|publishedAt|createdAt; dir: asc|desc)
//            defaults to publishedAt:desc

const LibraryHealthQuery = z.object({
  type: z.string().optional(),
  sort: z.string().optional(),
});

router.get("/cms/collateral/library-health", ...readGuard, async (req, res) => {
  const parsed = LibraryHealthQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const { type, sort } = parsed.data;

  const typeFilter = type
    ? (type
        .split(",")
        .map((t) => t.trim())
        .filter((t) => (COLLATERAL_TYPES as readonly string[]).includes(t)) as (typeof COLLATERAL_TYPES)[number][])
    : [];

  const filters = [
    isNull(collateralTable.deletedAt),
    eq(collateralTable.active, true),
    // Both description and seoDescription are absent/blank
    sql`(${collateralTable.description} is null or trim(${collateralTable.description}) = '')`,
    sql`(${collateralTable.seoDescription} is null or trim(${collateralTable.seoDescription}) = '')`,
  ];
  if (typeFilter.length) {
    filters.push(inArray(collateralTable.type, typeFilter));
  }

  // Sort parsing — restricted to columns relevant for this diagnostic view.
  const LibraryHealthSortableColumns = {
    type: collateralTable.type,
    title: collateralTable.title,
    publishedAt: collateralTable.publishedAt,
    createdAt: collateralTable.createdAt,
  } as const;
  type LibraryHealthSortCol = keyof typeof LibraryHealthSortableColumns;

  const orderByClauses = [];
  if (sort) {
    for (const part of sort.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [rawCol, rawDir] = part.split(":").map((s) => s.trim());
      const col = LibraryHealthSortableColumns[rawCol as LibraryHealthSortCol];
      if (!col) continue;
      const dir = rawDir?.toLowerCase() === "asc" ? "asc" : "desc";
      // publishedAt may be null for draft/unscheduled items — send to end
      if (rawCol === "publishedAt") {
        orderByClauses.push(dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`);
      } else {
        orderByClauses.push(dir === "asc" ? asc(col) : desc(col));
      }
    }
  }
  if (orderByClauses.length === 0) {
    orderByClauses.push(
      sql`${collateralTable.publishedAt} desc nulls last`,
      asc(collateralTable.title),
    );
  }

  const rows = await db
    .select({
      id: collateralTable.id,
      slug: collateralTable.slug,
      type: collateralTable.type,
      title: collateralTable.title,
      publishedAt: collateralTable.publishedAt,
      createdAt: collateralTable.createdAt,
      updatedAt: collateralTable.updatedAt,
    })
    .from(collateralTable)
    .where(and(...filters))
    .orderBy(...(orderByClauses as [ReturnType<typeof asc>, ...ReturnType<typeof asc>[]]));

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      title: r.title,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: rows.length,
  });
});

// ----- Audit ------------------------------------------------------------
//
// Admin-only diagnostic that scans the collateral table and source-of-truth
// tables for consistency drift. Read-only; never mutates anything. Findings
// are returned as a structured JSON document the audit page renders as
// collapsible sections. Each entry carries enough context (id, slug, type)
// for an editor to navigate to the offender and resolve it.
//
// white_papers can mirror to either `white_paper` or `ebook` because the
// docType column in white_papers distinguishes the two at sync time.

router.get("/cms/collateral/audit", ...readGuard, async (_req, res) => {
  const generatedAt = new Date().toISOString();

  // Pull every collateral row (including hidden, excluding soft-deleted).
  const collateralRows = await db
    .select()
    .from(collateralTable)
    .where(isNull(collateralTable.deletedAt));

  const totals = {
    collateralRows: collateralRows.length,
    syncedRows: collateralRows.filter((r) => r.sourceId).length,
    standaloneRows: collateralRows.filter((r) => !r.sourceId).length,
  };

  // Check 1: URL drift — collateral.url should equal canonicalUrlFor(type, slug)
  // unless the row is external (off-site link, e.g. an external event registration).
  const urlDrift = collateralRows
    .filter((r) => !r.external)
    .filter((r) => r.url !== canonicalUrlForCollateral(r.type, r.slug))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      currentUrl: r.url,
      expectedUrl: canonicalUrlForCollateral(r.type, r.slug),
    }));

  // Check 2: sourceId format drift — synced rows should have "<prefix>:<uuid>"
  // shape, not a raw UUID or other format.
  const SOURCE_ID_PATTERN = /^[a-z_]+:[0-9a-f-]+$/;
  const sourceIdFormatDrift = collateralRows
    .filter((r) => r.sourceId && !SOURCE_ID_PATTERN.test(r.sourceId))
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      type: r.type,
      sourceId: r.sourceId!,
    }));

  // Check 3: type mismatch — sourceId prefix should map to a collateral.type
  // that's in the expected set for that source table.
  const PREFIX_TO_EXPECTED_TYPES: Record<string, string[]> = {
    white_paper: ["white_paper", "ebook"],
    case_study: ["case_study"],
    model: ["model"],
    video: ["video"],
    post: ["insight"],
    polaris_episode: ["podcast"],
    event: ["event"],
    landing_page: ["landing_page"],
  };
  const typeMismatch = collateralRows
    .filter((r) => r.sourceId && SOURCE_ID_PATTERN.test(r.sourceId))
    .map((r) => {
      const [prefix] = r.sourceId!.split(":");
      const expected = PREFIX_TO_EXPECTED_TYPES[prefix];
      return { row: r, prefix, expected };
    })
    .filter(({ row, expected }) => expected && !expected.includes(row.type))
    .map(({ row, prefix, expected }) => ({
      id: row.id,
      slug: row.slug,
      type: row.type,
      sourceId: row.sourceId!,
      sourcePrefix: prefix,
      expectedTypes: expected!,
    }));

  // Check 4: duplicate sourceId — multiple collateral rows pointing at the
  // same source. The sync helper's findFirst will only update one of them,
  // leaving the others stale.
  const sourceIdCounts = new Map<string, typeof collateralRows>();
  for (const r of collateralRows) {
    if (!r.sourceId) continue;
    const list = sourceIdCounts.get(r.sourceId) ?? [];
    list.push(r);
    sourceIdCounts.set(r.sourceId, list);
  }
  const duplicateSourceId = Array.from(sourceIdCounts.entries())
    .filter(([, list]) => list.length > 1)
    .map(([sourceId, list]) => ({
      sourceId,
      collateral: list.map((r) => ({
        id: r.id,
        slug: r.slug,
        type: r.type,
        active: r.active,
      })),
    }));

  // Per-source-table cross-checks (Checks 5, 6, 7).
  //
  // For each source table we run three queries-worth of cross-references
  // against `collateralRows`:
  //   - orphanedSync: collateral rows whose sourceId points at a row that
  //     doesn't exist (or is soft-deleted) in the source table
  //   - missingMirror: published source rows with no active collateral mirror
  //   - countMismatch: published-active source rows vs active collateral
  //     mirrors of expected types

  const orphanedSync: Array<{
    id: string;
    slug: string;
    type: string;
    sourceId: string;
    reason: string;
  }> = [];
  const missingMirror: Record<
    string,
    Array<{ id: string; slug: string; title: string }>
  > = {};
  const countMismatch: Array<{
    sourceTable: string;
    publishedActive: number;
    activeMirrors: number;
    delta: number;
  }> = [];

  // Fetch source rows for each table. Each query selects the minimum we need.
  const [
    whitePaperRows,
    caseStudyRows,
    modelRows,
    videoRows,
    postRows,
    polarisRows,
    eventRows,
    landingPageRows,
  ] =
    await Promise.all([
      db
        .select({
          id: whitePapersTable.id,
          slug: whitePapersTable.slug,
          title: whitePapersTable.title,
          status: whitePapersTable.status,
          active: whitePapersTable.active,
          deletedAt: whitePapersTable.deletedAt,
        })
        .from(whitePapersTable),
      db
        .select({
          id: caseStudiesTable.id,
          slug: caseStudiesTable.slug,
          title: caseStudiesTable.title,
          status: caseStudiesTable.status,
          active: caseStudiesTable.active,
          deletedAt: caseStudiesTable.deletedAt,
        })
        .from(caseStudiesTable),
      db
        .select({
          id: modelsTable.id,
          slug: modelsTable.slug,
          title: modelsTable.title,
          status: modelsTable.status,
          active: modelsTable.active,
          deletedAt: modelsTable.deletedAt,
        })
        .from(modelsTable),
      db
        .select({
          id: videosTable.id,
          slug: videosTable.slug,
          title: videosTable.title,
          status: videosTable.status,
          active: videosTable.active,
          deletedAt: videosTable.deletedAt,
        })
        .from(videosTable),
      db
        .select({
          id: postsTable.id,
          slug: postsTable.slug,
          title: postsTable.title,
          status: postsTable.status,
          // Posts only sync to collateral when featured=true (see
          // upsertCollateralFromPost). Audit checks must mirror this gate
          // or every published post would falsely show up as missing.
          featured: postsTable.featured,
          deletedAt: postsTable.deletedAt,
        })
        .from(postsTable),
      db
        .select({
          id: polarisEpisodesTable.id,
          slug: polarisEpisodesTable.slug,
          title: polarisEpisodesTable.title,
          status: polarisEpisodesTable.status,
          active: polarisEpisodesTable.active,
          deletedAt: polarisEpisodesTable.deletedAt,
        })
        .from(polarisEpisodesTable),
      db
        .select({
          id: eventsTable.id,
          slug: eventsTable.slug,
          title: eventsTable.title,
          status: eventsTable.status,
        })
        .from(eventsTable),
      db
        .select({
          id: landingPagesTable.id,
          slug: landingPagesTable.slug,
          title: landingPagesTable.title,
          status: landingPagesTable.status,
          active: landingPagesTable.active,
          featured: landingPagesTable.featured,
          publishedAt: landingPagesTable.publishedAt,
          unpublishedAt: landingPagesTable.unpublishedAt,
          deletedAt: landingPagesTable.deletedAt,
        })
        .from(landingPagesTable),
    ]);

  // Build a sourceId -> source row index for orphan detection. The source's
  // own id is namespaced by prefix to avoid collisions across tables.
  const sourceIndex = new Map<string, { active: boolean }>();
  const addToIndex = <T extends { id: unknown }>(
    prefix: string,
    rows: ReadonlyArray<T>,
    isActive: (r: T) => boolean,
  ) => {
    for (const row of rows) {
      sourceIndex.set(`${prefix}:${String(row.id)}`, { active: isActive(row) });
    }
  };
  addToIndex(
    "white_paper",
    whitePaperRows,
    (r) => r.status === "published" && r.active === true && !r.deletedAt,
  );
  addToIndex(
    "case_study",
    caseStudyRows,
    (r) => r.status === "published" && r.active === true && !r.deletedAt,
  );
  addToIndex(
    "model",
    modelRows,
    (r) => r.status === "published" && r.active === true && !r.deletedAt,
  );
  addToIndex(
    "video",
    videoRows,
    (r) => r.status === "published" && r.active === true && !r.deletedAt,
  );
  addToIndex(
    "post",
    postRows,
    // Match upsertCollateralFromPost's eligibility: featured + published
    // + not deleted. An unfeatured post should drop out of collateral.
    (r) => r.featured === true && r.status === "published" && !r.deletedAt,
  );
  addToIndex(
    "polaris_episode",
    polarisRows,
    (r) => r.status === "published" && r.active === true && !r.deletedAt,
  );
  // Events sync uses status !== "CANCELLED" as the active gate.
  addToIndex("event", eventRows, (r) => r.status !== "CANCELLED");
  // Landing pages opt into the library via the featured flag and honour a
  // publish window — mirror upsertCollateralFromLandingPage's eligibility
  // exactly so unfeatured / out-of-window pages aren't flagged as missing.
  const auditNow = new Date();
  const landingPageEligible = (r: (typeof landingPageRows)[number]) =>
    r.featured === true &&
    r.active === true &&
    r.status === "published" &&
    !r.deletedAt &&
    (!r.publishedAt || r.publishedAt <= auditNow) &&
    (!r.unpublishedAt || r.unpublishedAt > auditNow);
  addToIndex("landing_page", landingPageRows, landingPageEligible);

  // orphanedSync: collateral.sourceId is set but doesn't resolve to any row
  for (const r of collateralRows) {
    if (!r.sourceId || !SOURCE_ID_PATTERN.test(r.sourceId)) continue;
    const hit = sourceIndex.get(r.sourceId);
    if (!hit) {
      orphanedSync.push({
        id: r.id,
        slug: r.slug,
        type: r.type,
        sourceId: r.sourceId,
        reason: "source_row_missing",
      });
    } else if (!hit.active) {
      // Row exists but is unpublished/inactive/deleted — the mirror should
      // probably be inactive too. Sync handles this on edit, but if the row
      // never gets re-edited, the mirror can stay live.
      if (r.active) {
        orphanedSync.push({
          id: r.id,
          slug: r.slug,
          type: r.type,
          sourceId: r.sourceId,
          reason: "source_unpublished_but_mirror_active",
        });
      }
    }
  }

  // missingMirror + countMismatch: for each source table, find published-active
  // rows that don't have any active collateral mirror (matching expected types).
  type SourceCheckRow = {
    id: string;
    slug: string;
    title: string;
    isPublishedActive: boolean;
  };
  const checkSourceTable = (
    label: string,
    prefix: string,
    rows: SourceCheckRow[],
    expectedTypes: string[],
  ) => {
    const published = rows.filter((r) => r.isPublishedActive);
    // Track whether *any* mirror with this sourceId is active. The
    // duplicateSourceId check separately reports the duplication; here we
    // only want to flag a source row as "missing" when no active mirror
    // exists for it — otherwise a stale inactive duplicate would mask the
    // valid active one.
    const hasActiveMirror = new Map<string, boolean>();
    for (const r of collateralRows) {
      if (!r.sourceId) continue;
      if (!r.sourceId.startsWith(`${prefix}:`)) continue;
      if (r.active) {
        hasActiveMirror.set(r.sourceId, true);
      } else if (!hasActiveMirror.has(r.sourceId)) {
        hasActiveMirror.set(r.sourceId, false);
      }
    }
    const missing = published
      .filter((r) => !hasActiveMirror.get(`${prefix}:${r.id}`))
      .map((r) => ({ id: r.id, slug: r.slug, title: r.title }));
    if (missing.length > 0) missingMirror[label] = missing;

    const activeMirrors = collateralRows.filter(
      (r) =>
        r.active &&
        r.sourceId &&
        r.sourceId.startsWith(`${prefix}:`) &&
        expectedTypes.includes(r.type),
    ).length;
    if (activeMirrors !== published.length) {
      countMismatch.push({
        sourceTable: label,
        publishedActive: published.length,
        activeMirrors,
        delta: activeMirrors - published.length,
      });
    }
  };
  checkSourceTable(
    "white_papers",
    "white_paper",
    whitePaperRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublishedActive: r.status === "published" && r.active === true && !r.deletedAt,
    })),
    ["white_paper", "ebook"],
  );
  checkSourceTable(
    "case_studies",
    "case_study",
    caseStudyRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublishedActive: r.status === "published" && r.active === true && !r.deletedAt,
    })),
    ["case_study"],
  );
  checkSourceTable(
    "models",
    "model",
    modelRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublishedActive: r.status === "published" && r.active === true && !r.deletedAt,
    })),
    ["model"],
  );
  checkSourceTable(
    "videos",
    "video",
    videoRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublishedActive: r.status === "published" && r.active === true && !r.deletedAt,
    })),
    ["video"],
  );
  checkSourceTable(
    "posts",
    "post",
    postRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      // Posts opt into the library via the featured flag — only featured
      // published posts get a collateral mirror, so only those are
      // eligible to flag as missing.
      isPublishedActive:
        r.featured === true && r.status === "published" && !r.deletedAt,
    })),
    ["insight"],
  );
  checkSourceTable(
    "landing_pages",
    "landing_page",
    landingPageRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      // Landing pages mirror into the library only when featured +
      // published + active + within the publish window (see
      // upsertCollateralFromLandingPage). Match that gate exactly.
      isPublishedActive: landingPageEligible(r),
    })),
    ["landing_page"],
  );

  res.json({
    generatedAt,
    totals,
    findings: {
      urlDrift,
      sourceIdFormatDrift,
      typeMismatch,
      duplicateSourceId,
      orphanedSync,
      missingMirror,
      countMismatch,
    },
  });
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
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
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
    if (d.seoTitle !== undefined) updates.seoTitle = d.seoTitle;
    if (d.seoDescription !== undefined) updates.seoDescription = d.seoDescription;

    // Re-derive url whenever slug or type changes. For external rows the
    // client url is preserved (those point at off-site resources). Client
    // url is otherwise ignored to prevent /items/<slug> regressions.
    const nextSlug = (updates.slug as string | undefined) ?? existing.slug;
    const nextType = (updates.type as string | undefined) ?? existing.type;
    const nextExternal = (updates.external as boolean | undefined) ?? existing.external;
    if (nextExternal) {
      if (d.url !== undefined) {
        const nextUrl = d.url?.trim() ?? "";
        if (!nextUrl) {
          res.status(400).json({
            error: "External collateral requires a non-empty url",
          });
          return;
        }
        updates.url = nextUrl;
      } else if (existing.external) {
        // Preserve the existing off-site URL when patching only curation fields
        updates.url = existing.url;
      } else {
        res.status(400).json({
          error: "Provide a non-empty url when setting external=true",
        });
        return;
      }
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
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(collateralTable)
        .set({ featuredRank: index + 1, updatedAt })
        .where(eq(collateralTable.id, id));
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

// Task #318 — Collateral × Solutions join admin endpoints. Mirrors the
// shape of cmsReplaceSolutionHighlights but from the collateral side so
// each library editor (collateral, white papers, videos, workshops,
// Polaris episodes) can manage solution links inline.
const CollateralSolutionsBody = z.object({
  items: z
    .array(
      z.object({
        solutionId: z.string().uuid(),
        displayOrder: z.number().int().optional(),
        active: z.boolean().optional(),
      }),
    )
    .max(100),
});

async function loadCollateralSolutionsForAdmin(collateralId: string) {
  const rows = await db
    .select({
      link: collateralSolutionsTable,
      sol: solutionsTable,
      svc: servicesTable,
    })
    .from(collateralSolutionsTable)
    .innerJoin(
      solutionsTable,
      eq(collateralSolutionsTable.solutionId, solutionsTable.id),
    )
    .leftJoin(
      servicesTable,
      eq(solutionsTable.parentServiceId, servicesTable.id),
    )
    .where(eq(collateralSolutionsTable.collateralId, collateralId))
    .orderBy(
      asc(collateralSolutionsTable.displayOrder),
      asc(solutionsTable.title),
    );
  return rows.map((r) => ({
    solutionId: r.sol.id,
    displayOrder: r.link.displayOrder,
    active: r.link.active,
    solutionTitle: r.sol.title,
    solutionSlug: r.sol.slug,
    parentServiceId: r.svc?.id ?? null,
    parentServiceTitle: r.svc?.title ?? null,
  }));
}

// Task #318 — Resolve a typed source row (white paper, video, workshop,
// polaris episode, …) to its mirrored `collateralTable` id so the typed
// editors can manage solution links without round-tripping through the
// generic collateral list.
router.get(
  "/cms/collateral/by-source/:sourceId",
  ...readGuard,
  async (req, res) => {
    const sourceId = String(req.params.sourceId);
    const row = await db.query.collateralTable.findFirst({
      where: and(
        eq(collateralTable.sourceId, sourceId),
        isNull(collateralTable.deletedAt),
      ),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ collateralId: row.id });
  },
);

router.get(
  "/cms/collateral/:id/solutions",
  ...readGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.id, id),
    });
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ items: await loadCollateralSolutionsForAdmin(id) });
  },
);

router.put(
  "/cms/collateral/:id/solutions",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.id, id),
    });
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = CollateralSolutionsBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    // Normalize ordering by payload position; collapse duplicate
    // solutionIds to the last entry seen. Mirrors the
    // cmsReplaceSolutionHighlights upsert semantics.
    const seen = new Map<
      string,
      { solutionId: string; displayOrder: number; active: boolean }
    >();
    parsed.data.items.forEach((item, idx) => {
      seen.set(item.solutionId, {
        solutionId: item.solutionId,
        displayOrder: idx,
        active: item.active ?? true,
      });
    });
    const desired = Array.from(seen.values());
    await db.transaction(async (tx) => {
      await tx
        .delete(collateralSolutionsTable)
        .where(eq(collateralSolutionsTable.collateralId, id));
      if (desired.length > 0) {
        await tx.insert(collateralSolutionsTable).values(
          desired.map((d) => ({
            collateralId: id,
            solutionId: d.solutionId,
            displayOrder: d.displayOrder,
            active: d.active,
          })),
        );
      }
    });
    await audit({
      actorId: req.authedUser!.id,
      action: "collateral.solutions.replace",
      entity: "collateral",
      entityId: id,
    });
    res.json({ items: await loadCollateralSolutionsForAdmin(id) });
  },
);

export default router;
