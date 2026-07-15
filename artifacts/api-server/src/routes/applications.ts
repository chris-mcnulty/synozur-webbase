import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  ARTIFACT_STATUSES,
  type Application,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import { publishedAtNullOrReachedSql } from "../lib/publishWindow";
import { isGone, sendGone } from "../lib/goneResponse";
import { submitIfTransitionedToGone } from "../lib/seoUnpublishSubmit";
import {
  upsertCollateralFromApplication,
  softDeleteCollateralForApplication,
} from "../lib/syncCollateral";
import { loadLinkedBooking, type LinkedBookingDto } from "../lib/bookingUtils";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

async function ensureUniqueApplicationSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const found = await db.query.applicationsTable.findFirst({
      where: excludeId
        ? and(
            eq(applicationsTable.slug, slug),
            ne(applicationsTable.id, excludeId),
          )
        : eq(applicationsTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(a: Application, booking: LinkedBookingDto | null = null) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    name: a.name,
    tagline: a.tagline,
    shortSummary: a.shortSummary,
    description: a.descriptionParagraphs,
    version: a.version,
    releaseDate: a.releaseDate,
    websiteUrl: a.websiteUrl,
    logo: a.logo,
    screenshot: a.screenshot,
    userGuideUrl: a.userGuideUrl,
    showInNav: a.showInNav,
    serviceId: a.serviceId,
    solutionId: a.solutionId,
    bookingId: a.bookingId ?? null,
    booking,
    status: a.status,
    publishedAt: a.publishedAt,
    unpublishedAt: a.unpublishedAt,
    featured: a.featured,
    featuredRank: a.featuredRank,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    ogImage: a.ogImage,
    active: a.active,
    sourceId: a.sourceId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// ----- Public ------------------------------------------------------------

// Every visible-on-site row, ordered for display. The header nav,
// footer, sitemap, and /applications page all read from this single
// endpoint so we never drift again. Callers that only want nav-visible
// items should pass `?nav=true`.
router.get("/applications", async (req, res) => {
  const navOnly = req.query.nav === "true";
  const whereClauses = [
    eq(applicationsTable.active, true),
    eq(applicationsTable.status, "published"),
    sql`${applicationsTable.deletedAt} is null`,
    publishedAtNullOrReachedSql(applicationsTable.publishedAt),
    sql`(${applicationsTable.unpublishedAt} is null or ${applicationsTable.unpublishedAt} > now())`,
  ];
  if (navOnly) {
    whereClauses.push(eq(applicationsTable.showInNav, true));
  }
  const rows = await db
    .select()
    .from(applicationsTable)
    .where(and(...whereClauses))
    .orderBy(
      desc(applicationsTable.featured),
      sql`${applicationsTable.featuredRank} asc nulls last`,
      asc(applicationsTable.title),
    );
  res.json({ items: rows.map((a) => serialize(a)) });
});

router.get("/applications/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.applicationsTable.findFirst({
    where: and(
      eq(applicationsTable.slug, slug),
      sql`${applicationsTable.deletedAt} is null`,
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // #162: archived or past-unpublishedAt returns 410 Gone for prompt de-indexing.
  if (isGone(row)) {
    sendGone(res, "application");
    return;
  }
  if (
    !row.active ||
    row.status !== "published" ||
    (row.publishedAt && row.publishedAt > new Date())
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const booking = await loadLinkedBooking(row.bookingId ?? null);
  res.json(serialize(row, booking));
});

// ----- Admin -------------------------------------------------------------

const ApplicationBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  name: z.string().optional(),
  tagline: z.string().optional(),
  shortSummary: z.string().optional(),
  description: z.array(z.string()).optional(),
  version: z.string().nullish(),
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "releaseDate must be in YYYY-MM-DD format")
    .nullish(),
  websiteUrl: z.string().optional(),
  logo: z.string().optional(),
  screenshot: z.string().optional(),
  userGuideUrl: z.string().nullish(),
  showInNav: z.boolean().optional(),
  serviceId: z.string().uuid().nullish(),
  solutionId: z.string().uuid().nullish(),
  bookingId: z.string().uuid().nullish(),
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
const ApplicationPatch = ApplicationBody.partial();

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cms/applications", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(applicationsTable)
    .where(sql`${applicationsTable.deletedAt} is null`)
    .orderBy(
      desc(applicationsTable.featured),
      sql`${applicationsTable.featuredRank} asc nulls last`,
      asc(applicationsTable.title),
    );
  res.json({ items: rows.map((a) => serialize(a)) });
});

router.get("/cms/applications/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/applications", ...adminGuard, async (req, res) => {
  const parsed = ApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueApplicationSlug(d.slug || d.title);
  const [row] = await db
    .insert(applicationsTable)
    .values({
      slug,
      title: d.title,
      name: d.name ?? d.title,
      tagline: d.tagline ?? "",
      shortSummary: d.shortSummary ?? "",
      descriptionParagraphs: d.description ?? [],
      version: d.version ?? null,
      releaseDate: d.releaseDate ?? null,
      websiteUrl: d.websiteUrl ?? "",
      logo: d.logo ?? "",
      screenshot: d.screenshot ?? "",
      userGuideUrl: d.userGuideUrl ?? null,
      showInNav: d.showInNav !== false,
      serviceId: d.serviceId ?? null,
      solutionId: d.solutionId ?? null,
      bookingId: d.bookingId ?? null,
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
  await upsertCollateralFromApplication(row);
  await audit({
    actorId: req.authedUser!.id,
    action: "application.create",
    entity: "application",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/applications/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ApplicationPatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueApplicationSlug(d.slug, id);
  }
  for (const k of [
    "title",
    "name",
    "tagline",
    "shortSummary",
    "version",
    "releaseDate",
    "websiteUrl",
    "logo",
    "screenshot",
    "userGuideUrl",
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
  if (d.serviceId !== undefined) updates.serviceId = d.serviceId ?? null;
  if (d.solutionId !== undefined) updates.solutionId = d.solutionId ?? null;
  if (d.bookingId !== undefined) updates.bookingId = d.bookingId ?? null;
  if (d.description !== undefined) updates.descriptionParagraphs = d.description;
  if (d.showInNav !== undefined) {
    updates.showInNav = d.showInNav;
  }
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined)
    updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(applicationsTable)
    .set(updates)
    .where(eq(applicationsTable.id, id))
    .returning();

  // #254: ping search engines if this save flipped the row into a "gone" state.
  await submitIfTransitionedToGone({
    entityType: "application",
    entityId: id,
    slug: existing.slug,
    publicPath: `/applications/${existing.slug}`,
    alsoSubmitPath:
      updated.slug !== existing.slug ? `/applications/${updated.slug}` : undefined,
    before: existing,
    after: updated,
    log: req.log,
  });

  await upsertCollateralFromApplication(updated);

  await audit({
    actorId: req.authedUser!.id,
    action: "application.update",
    entity: "application",
    entityId: id,
  });
  res.json(serialize(updated));
});

router.delete("/cms/applications/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.applicationsTable.findFirst({
    where: eq(applicationsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(applicationsTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(applicationsTable.id, id));
  // #254: soft-delete (active=false) returns 404 Not Found for applications,
  // not 410 Gone, so we deliberately do not submit a removal here.
  await softDeleteCollateralForApplication(id);
  await audit({
    actorId: req.authedUser!.id,
    action: "application.delete",
    entity: "application",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
