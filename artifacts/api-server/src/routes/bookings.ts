import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db, bookingsTable, type Booking } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const SCOPES = ["general", "offer", "conference"] as const;
type Scope = (typeof SCOPES)[number];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  const seed = base || `booking-${Date.now()}`;
  let candidate = seed;
  let i = 2;
  for (let attempt = 0; attempt < 100; attempt++) {
    const existing = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(eq(bookingsTable.slug, candidate));
    const conflict = existing.find((row) => row.id !== ignoreId);
    if (!conflict) return candidate;
    candidate = `${seed}-${i++}`;
  }
  return `${seed}-${Date.now()}`;
}

function serialize(b: Booking) {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    teaser: b.teaser,
    descriptionHtml: b.descriptionHtml,
    embedUrl: b.embedUrl,
    scope: b.scope,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    displayOrder: b.displayOrder,
    active: b.active,
    seoTitle: b.seoTitle,
    seoDescription: b.seoDescription,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

const Body = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  teaser: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  embedUrl: z.string().url(),
  scope: z.enum(SCOPES).default("general"),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Public — list active bookings within their time window, plus per-slug fetch.
// ---------------------------------------------------------------------------

router.get("/bookings", async (_req, res): Promise<void> => {
  const now = new Date();
  const rows = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.active, true),
        or(sql`${bookingsTable.startsAt} is null`, sql`${bookingsTable.startsAt} <= ${now}`),
        or(sql`${bookingsTable.endsAt} is null`, sql`${bookingsTable.endsAt} > ${now}`),
      ),
    )
    .orderBy(asc(bookingsTable.displayOrder), asc(bookingsTable.title));
  res.json({ items: rows.map(serialize) });
});

router.get("/bookings/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params.slug);
  const [row] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.slug, slug));
  if (!row || !row.active) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const now = new Date();
  if (row.startsAt && row.startsAt > now) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (row.endsAt && row.endsAt <= now) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(serialize(row));
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

router.get("/admin/bookings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(bookingsTable)
    .orderBy(asc(bookingsTable.displayOrder), asc(bookingsTable.title));
  res.json({ items: rows.map(serialize) });
});

router.get("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/admin/bookings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slugBase = parsed.data.slug?.trim() || slugify(parsed.data.title);
  const slug = await ensureUniqueSlug(slugBase);
  const [row] = await db
    .insert(bookingsTable)
    .values({
      slug,
      title: parsed.data.title,
      teaser: parsed.data.teaser ?? null,
      descriptionHtml: parsed.data.descriptionHtml ?? null,
      embedUrl: parsed.data.embedUrl,
      scope: parsed.data.scope,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      displayOrder: parsed.data.displayOrder ?? 0,
      active: parsed.data.active ?? true,
      seoTitle: parsed.data.seoTitle ?? null,
      seoDescription: parsed.data.seoDescription ?? null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.patch("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = Body.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) updates.title = d.title;
  if (d.teaser !== undefined) updates.teaser = d.teaser ?? null;
  if (d.descriptionHtml !== undefined) updates.descriptionHtml = d.descriptionHtml ?? null;
  if (d.embedUrl !== undefined) updates.embedUrl = d.embedUrl;
  if (d.scope !== undefined) updates.scope = d.scope;
  if (d.startsAt !== undefined) updates.startsAt = d.startsAt ?? null;
  if (d.endsAt !== undefined) updates.endsAt = d.endsAt ?? null;
  if (d.displayOrder !== undefined) updates.displayOrder = d.displayOrder;
  if (d.active !== undefined) updates.active = d.active;
  if (d.seoTitle !== undefined) updates.seoTitle = d.seoTitle ?? null;
  if (d.seoDescription !== undefined) updates.seoDescription = d.seoDescription ?? null;

  if (d.slug !== undefined && d.slug !== null) {
    const slugBase = d.slug.trim() || slugify(d.title ?? existing.title);
    updates.slug = await ensureUniqueSlug(slugBase, id);
  } else if (d.title !== undefined && !existing.slug) {
    updates.slug = await ensureUniqueSlug(slugify(d.title), id);
  }

  const [row] = await db
    .update(bookingsTable)
    .set(updates)
    .where(eq(bookingsTable.id, id))
    .returning();
  res.json(serialize(row));
});

router.delete("/admin/bookings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [row] = await db
    .delete(bookingsTable)
    .where(eq(bookingsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
