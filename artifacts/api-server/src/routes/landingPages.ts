import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import {
  db,
  landingPagesTable,
  isLandingPagePubliclyVisible,
  LANDING_PAGE_BLOCK_TYPES,
  LANDING_PAGE_STATUSES,
  type LandingPage,
  type LandingPageBlock,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

// Editors get full CRUD; same gate as the rest of the CMS write routes.
const adminGuard = [requireAuth, requireRole("admin", "editor")];

// Slug values that cannot be claimed by a landing page because they collide
// with code-backed routes (admin shells, auth, etc.). Detail pages like
// /services/:slug are not at risk because they live under a prefix; we only
// need to protect single-segment URLs.
const RESERVED_SLUGS = new Set<string>([
  "admin",
  "api",
  "sign-in",
  "sign-up",
  "verify-email",
  "pending-approval",
  "forgot-password",
  "reset-password",
  "home-a",
  "home-b",
]);

const BlockSchema = z.object({ type: z.enum(LANDING_PAGE_BLOCK_TYPES) }).passthrough();

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
    blocks: (row.blocks ?? []) as LandingPageBlock[],
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
  let slug = toSlug(base);
  let i = 1;
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
    i++;
    slug = `${toSlug(base)}-${i}`;
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

export default router;
