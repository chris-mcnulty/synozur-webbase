import { Router, type IRouter } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import {
  db,
  contentParentPagesTable,
  type ContentParentPage,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

function serialize(p: ContentParentPage) {
  return {
    id: p.id,
    slug: p.slug,
    heroEyebrow: p.heroEyebrow,
    heroHeadline: p.heroHeadline,
    heroSubhead: p.heroSubhead,
    introHtml: p.introHtml,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    ogImage: p.ogImage,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public — each list page reads its row on mount by slug (= first path
// segment). Missing rows return 404 so the client can fall back to the
// component-level defaults.
// ---------------------------------------------------------------------------

router.get("/content-parent-pages/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.contentParentPagesTable.findFirst({
    where: eq(contentParentPagesTable.slug, slug),
  });
  if (!row || !row.active) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ---------------------------------------------------------------------------
// Admin — list + upsert-by-slug. There is no "create" flow because the set
// of list-page slugs is fixed: the seed backfills rows on first run, and
// new list pages should be added via migration + seed, not the UI. Patch
// is keyed by id.
// ---------------------------------------------------------------------------

const Body = z.object({
  heroEyebrow: z.string().nullish(),
  heroHeadline: z.string().nullish(),
  heroSubhead: z.string().nullish(),
  introHtml: z.string().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  ogImage: z.string().nullish(),
  active: z.boolean().optional(),
});
const Patch = Body.partial();

router.get("/cms/content-parent-pages", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(contentParentPagesTable)
    .orderBy(asc(contentParentPagesTable.slug));
  res.json({ items: rows.map(serialize) });
});

router.patch("/cms/content-parent-pages/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.contentParentPagesTable.findFirst({
    where: eq(contentParentPagesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = Patch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "heroEyebrow",
    "heroHeadline",
    "heroSubhead",
    "introHtml",
    "seoTitle",
    "seoDescription",
    "ogImage",
    "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(contentParentPagesTable)
    .set(updates)
    .where(eq(contentParentPagesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "content_parent_page.update",
    entity: "content_parent_page",
    entityId: id,
  });
  res.json(serialize(updated));
});

export default router;
