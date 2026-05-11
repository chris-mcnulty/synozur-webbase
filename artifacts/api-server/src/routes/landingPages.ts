import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import {
  db,
  landingPagesTable,
  landingPageBlocks,
  isLandingPagePubliclyVisible,
  LANDING_PAGE_BLOCK_TYPES,
  LANDING_PAGE_STATUSES,
  type LandingPage,
  type LandingPageBlock,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

// `site.manage` is the same capability used for List Page Copy, Site
// Settings, and the rest of the admin "Site Config" tools — landing pages
// belong with that group. Capability gates are preferred over role gates
// per the project convention in middlewares/auth.ts (#111).
const adminGuard = [requireAuth, requireCapability("site.manage")];

// Slug values that cannot be claimed by a landing page because they would
// be unreachable: the SPA's `/:slug` catch-all only matches single-segment
// URLs that aren't already claimed by a more specific public route, and a
// "published" DB page on one of these slugs would never render.
//
// Detail routes (e.g. `/services/:slug`, `/insights/:slug`) live under a
// prefix and don't conflict — we only block the standalone single-segment
// paths.
const RESERVED_SLUGS = new Set<string>([
  // Admin / API / auth shells
  "admin",
  "api",
  "sign-in",
  "sign-up",
  "verify-email",
  "pending-approval",
  "forgot-password",
  "reset-password",
  // Marketing-site code routes
  "home-a",
  "home-b",
  "about",
  "clients",
  "case-studies",
  "applications",
  "models",
  "workshops",
  "library",
  "search",
  "webinars",
  "videos",
  "white-papers",
  "items",
  "faq",
  "team",
  "partners",
  "insights",
  "polaris",
  "contact",
  "careers",
  "join",
  "start",
  "events",
  "privacy",
  "terms",
  // Reserved hub pages that don't live on this domain today but commonly
  // get claimed by future code routes.
  "services",
  "solutions",
]);

// Per-type Zod validation for block payloads lives in a sibling file so
// the unit test can import it without booting Express / db. The public
// renderer trusts the stored shape (`block.cards.map(...)`), so a
// malformed write — via Create / Update / Import — would crash the page
// on every visit. We validate strictly here and let the API reject bad
// input with a 400 instead of persisting it.
import { BlockSchema } from "./landingPagesSchema";
// LANDING_PAGE_BLOCK_TYPES from the db package still anchors the runtime
// tag list; re-exporting it via BlockSchema keeps the union and the tag
// list separate but trivially auditable.
void LANDING_PAGE_BLOCK_TYPES;

const CreateBody = z.object({
  slug: z.string().min(1).nullish(),
  title: z.string().min(1),
  status: z.enum(LANDING_PAGE_STATUSES).optional(),
  blocks: z.array(BlockSchema).optional(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  seoCanonicalUrl: z.string().nullish(),
  ogImageUrl: z.string().nullish(),
});
const UpdateBody = CreateBody.partial();

function serialize(row: LandingPage) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    blocks: landingPageBlocks(row),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    seoCanonicalUrl: row.seoCanonicalUrl,
    ogImageUrl: row.ogImageUrl,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  const baseSlug = toSlug(base);
  let slug = baseSlug;
  // First collision becomes `${baseSlug}-1`, second `${baseSlug}-2`, etc.
  let suffix = 0;
  while (true) {
    const rows = await db
      .select({ id: landingPagesTable.id })
      .from(landingPagesTable)
      .where(
        excludeId
          ? and(eq(landingPagesTable.slug, slug), ne(landingPagesTable.id, excludeId))
          : eq(landingPagesTable.slug, slug),
      )
      .limit(1);
    if (rows.length === 0) return slug;
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// Public read — only published, non-deleted rows are returned.
// ---------------------------------------------------------------------------

router.get("/landing-pages/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!slug) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const row = await db.query.landingPagesTable.findFirst({
    where: eq(landingPagesTable.slug, slug),
  });
  if (!row || !isLandingPagePubliclyVisible(row)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

router.get("/cms/landing-pages", ...adminGuard, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status =
    typeof req.query.status === "string" &&
    (LANDING_PAGE_STATUSES as readonly string[]).includes(req.query.status)
      ? (req.query.status as (typeof LANDING_PAGE_STATUSES)[number])
      : null;

  const conds = [isNull(landingPagesTable.deletedAt)];
  if (status) conds.push(eq(landingPagesTable.status, status));
  if (search) {
    const like = `%${search}%`;
    const orClause = or(
      ilike(landingPagesTable.title, like),
      ilike(landingPagesTable.slug, like),
    );
    if (orClause) conds.push(orClause);
  }

  const rows = await db
    .select()
    .from(landingPagesTable)
    .where(and(...conds))
    .orderBy(desc(landingPagesTable.updatedAt), asc(landingPagesTable.slug));
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/landing-pages/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.landingPagesTable.findFirst({
    where: eq(landingPagesTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/landing-pages", ...adminGuard, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slugBase = d.slug || d.title;
  const slug = await ensureUniqueSlug(slugBase);
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ error: `Slug "${slug}" is reserved.` });
    return;
  }
  const status = d.status ?? "draft";
  const [row] = await db
    .insert(landingPagesTable)
    .values({
      slug,
      title: d.title,
      status,
      blocks: (d.blocks ?? []) as unknown as LandingPageBlock[],
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
      seoCanonicalUrl: d.seoCanonicalUrl ?? null,
      ogImageUrl: d.ogImageUrl ?? null,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "landing_page.create",
    entity: "landing_page",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/landing-pages/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.landingPagesTable.findFirst({
    where: eq(landingPagesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (d.slug !== undefined && d.slug !== null) {
    const slug = await ensureUniqueSlug(d.slug, id);
    if (RESERVED_SLUGS.has(slug)) {
      res.status(400).json({ error: `Slug "${slug}" is reserved.` });
      return;
    }
    updates.slug = slug;
  }
  if (d.title !== undefined) updates.title = d.title;
  if (d.blocks !== undefined) updates.blocks = d.blocks;
  if (d.seoTitle !== undefined) updates.seoTitle = d.seoTitle;
  if (d.seoDescription !== undefined) updates.seoDescription = d.seoDescription;
  if (d.seoCanonicalUrl !== undefined) updates.seoCanonicalUrl = d.seoCanonicalUrl;
  if (d.ogImageUrl !== undefined) updates.ogImageUrl = d.ogImageUrl;
  if (d.status !== undefined) {
    updates.status = d.status;
    // First publish stamps publishedAt; re-publishing leaves the original
    // timestamp intact so it can act as a stable "first published" anchor.
    if (d.status === "published" && !existing.publishedAt) {
      updates.publishedAt = new Date();
    }
  }

  const [updated] = await db
    .update(landingPagesTable)
    .set(updates)
    .where(eq(landingPagesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "landing_page.update",
    entity: "landing_page",
    entityId: id,
  });
  res.json(serialize(updated));
});

router.delete("/cms/landing-pages/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const [row] = await db
    .update(landingPagesTable)
    .set({ deletedAt: new Date(), status: "archived", updatedAt: new Date() })
    .where(eq(landingPagesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await audit({
    actorId: req.authedUser!.id,
    action: "landing_page.delete",
    entity: "landing_page",
    entityId: id,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Export / import — JSON file round-trip so a page can be authored in dev
// and moved to prod without a full DB dump. Keyed by slug; ids and audit
// timestamps are intentionally stripped from the wire format so an import
// into a different environment doesn't trample local rows.
// ---------------------------------------------------------------------------

const EXPORT_FORMAT = "synozur-landing-page" as const;
const EXPORT_VERSION = 1 as const;

const ImportBody = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  page: z.object({
    slug: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(LANDING_PAGE_STATUSES),
    blocks: z.array(BlockSchema),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    seoCanonicalUrl: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
  }),
  // `force: true` lets the client confirm an overwrite after we returned
  // 409 on the first attempt. We bounce the operator through a confirm so
  // an unintentional re-upload can't silently overwrite a prod page.
  force: z.boolean().optional(),
});

router.get("/cms/landing-pages/:id/export", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.landingPagesTable.findFirst({
    where: eq(landingPagesTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    page: {
      slug: row.slug,
      title: row.title,
      status: row.status,
      blocks: landingPageBlocks(row),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      seoCanonicalUrl: row.seoCanonicalUrl,
      ogImageUrl: row.ogImageUrl,
    },
  };
  await audit({
    actorId: req.authedUser!.id,
    action: "landing_page.export",
    entity: "landing_page",
    entityId: id,
  });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${row.slug}.landing-page.json"`,
  );
  res.send(JSON.stringify(payload, null, 2));
});

router.post("/cms/landing-pages/import", ...adminGuard, async (req, res) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid import payload", details: parsed.error.flatten() });
    return;
  }
  const { page, force } = parsed.data;
  const slug = toSlug(page.slug);
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ error: `Slug "${slug}" is reserved.` });
    return;
  }
  const existing = await db.query.landingPagesTable.findFirst({
    where: eq(landingPagesTable.slug, slug),
  });

  // Detect conflicts up-front so the admin UI can prompt for confirmation
  // before clobbering an existing row. The client retries with force: true
  // once the operator has acknowledged the overwrite.
  if (existing && !force) {
    res.status(409).json({
      error: "Landing page with this slug already exists.",
      code: "SLUG_CONFLICT",
      existing: serialize(existing),
    });
    return;
  }

  const writable = {
    title: page.title,
    status: page.status,
    blocks: page.blocks as unknown as LandingPageBlock[],
    seoTitle: page.seoTitle ?? null,
    seoDescription: page.seoDescription ?? null,
    seoCanonicalUrl: page.seoCanonicalUrl ?? null,
    ogImageUrl: page.ogImageUrl ?? null,
  };

  let row: LandingPage;
  let mode: "created" | "updated";
  if (existing) {
    const [updated] = await db
      .update(landingPagesTable)
      .set({
        slug,
        ...writable,
        // Stamp publishedAt on first publish; preserve existing stamp on
        // re-publish so the audit history stays meaningful.
        publishedAt:
          page.status === "published" && !existing.publishedAt
            ? new Date()
            : existing.publishedAt,
        // If the row was soft-deleted, an import explicitly resurrects it.
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(landingPagesTable.id, existing.id))
      .returning();
    row = updated;
    mode = "updated";
  } else {
    const [created] = await db
      .insert(landingPagesTable)
      .values({
        slug,
        ...writable,
        publishedAt: page.status === "published" ? new Date() : null,
      })
      .returning();
    row = created;
    mode = "created";
  }

  await audit({
    actorId: req.authedUser!.id,
    action: `landing_page.import.${mode}`,
    entity: "landing_page",
    entityId: row.id,
  });
  res.status(mode === "created" ? 201 : 200).json({ mode, page: serialize(row) });
});

export default router;
