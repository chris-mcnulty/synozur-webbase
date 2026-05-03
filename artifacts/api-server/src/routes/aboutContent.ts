import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  db,
  aboutValuesTable,
  clientTestimonialsTable,
  partnerDescriptionsTable,
  type AboutValue,
  type ClientTestimonial,
  type PartnerDescription,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeValue(v: AboutValue) {
  return {
    id: v.id,
    slug: v.slug,
    title: v.title,
    body: v.body,
    icon: v.icon,
    displayOrder: v.displayOrder,
    active: v.active,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

function serializeTestimonial(t: ClientTestimonial) {
  return {
    id: t.id,
    slug: t.slug,
    quote: t.quote,
    authorName: t.authorName,
    authorRole: t.authorRole,
    organization: t.organization,
    caseStudySlug: t.caseStudySlug,
    displayOrder: t.displayOrder,
    active: t.active,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function serializePartner(p: PartnerDescription) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    logo: p.logo,
    websiteUrl: p.websiteUrl,
    category: p.category,
    displayOrder: p.displayOrder,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function ensureUniqueSlug(
  table: typeof aboutValuesTable | typeof clientTestimonialsTable | typeof partnerDescriptionsTable,
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    // Generic over multiple `*Table` schemas; widening here is intentional.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    const rows = await db
      .select({ id: t.id })
      .from(t)
      .where(
        excludeId
          ? and(eq(t.slug, slug), ne(t.id, excludeId))
          : eq(t.slug, slug),
      )
      .limit(1);
    if (rows.length === 0) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

// ---------------------------------------------------------------------------
// About values
// ---------------------------------------------------------------------------

const AboutValueBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  body: z.string().optional(),
  icon: z.string().nullish(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
const AboutValuePatch = AboutValueBody.partial();

router.get("/about/values", async (_req, res) => {
  const rows = await db
    .select()
    .from(aboutValuesTable)
    .where(eq(aboutValuesTable.active, true))
    .orderBy(
      asc(aboutValuesTable.displayOrder),
      asc(aboutValuesTable.createdAt),
    );
  res.json({ items: rows.map(serializeValue) });
});

router.get("/cms/about/values", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(aboutValuesTable)
    .orderBy(
      asc(aboutValuesTable.displayOrder),
      asc(aboutValuesTable.createdAt),
    );
  res.json({ items: rows.map(serializeValue) });
});

router.post("/cms/about/values", ...adminGuard, async (req, res) => {
  const parsed = AboutValueBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(aboutValuesTable, d.slug || d.title);
  const [row] = await db
    .insert(aboutValuesTable)
    .values({
      slug,
      title: d.title,
      body: d.body ?? "",
      icon: d.icon ?? null,
      displayOrder: d.displayOrder ?? 0,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "about_value.create",
    entity: "about_value",
    entityId: row.id,
  });
  res.status(201).json(serializeValue(row));
});

router.patch("/cms/about/values/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.aboutValuesTable.findFirst({
    where: eq(aboutValuesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = AboutValuePatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueSlug(aboutValuesTable, d.slug, id);
  }
  for (const k of ["title", "body", "icon", "displayOrder", "active"] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(aboutValuesTable)
    .set(updates)
    .where(eq(aboutValuesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "about_value.update",
    entity: "about_value",
    entityId: id,
  });
  res.json(serializeValue(updated));
});

router.delete("/cms/about/values/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  await db.delete(aboutValuesTable).where(eq(aboutValuesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "about_value.delete",
    entity: "about_value",
    entityId: id,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Client testimonials
// ---------------------------------------------------------------------------

const TestimonialBody = z.object({
  slug: z.string().nullish(),
  quote: z.string().min(1),
  authorName: z.string().optional(),
  authorRole: z.string().nullish(),
  organization: z.string().optional(),
  caseStudySlug: z.string().nullish(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
const TestimonialPatch = TestimonialBody.partial();

router.get("/testimonials", async (_req, res) => {
  const rows = await db
    .select()
    .from(clientTestimonialsTable)
    .where(eq(clientTestimonialsTable.active, true))
    .orderBy(
      asc(clientTestimonialsTable.displayOrder),
      asc(clientTestimonialsTable.createdAt),
    );
  res.json({ items: rows.map(serializeTestimonial) });
});

router.get("/cms/testimonials", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(clientTestimonialsTable)
    .orderBy(
      asc(clientTestimonialsTable.displayOrder),
      asc(clientTestimonialsTable.createdAt),
    );
  res.json({ items: rows.map(serializeTestimonial) });
});

router.post("/cms/testimonials", ...adminGuard, async (req, res) => {
  const parsed = TestimonialBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(
    clientTestimonialsTable,
    d.slug || `${d.authorName ?? "quote"}-${Date.now()}`,
  );
  const [row] = await db
    .insert(clientTestimonialsTable)
    .values({
      slug,
      quote: d.quote,
      authorName: d.authorName ?? "",
      authorRole: d.authorRole ?? null,
      organization: d.organization ?? "",
      caseStudySlug: d.caseStudySlug ?? null,
      displayOrder: d.displayOrder ?? 0,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "client_testimonial.create",
    entity: "client_testimonial",
    entityId: row.id,
  });
  res.status(201).json(serializeTestimonial(row));
});

router.patch("/cms/testimonials/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.clientTestimonialsTable.findFirst({
    where: eq(clientTestimonialsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = TestimonialPatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueSlug(clientTestimonialsTable, d.slug, id);
  }
  for (const k of [
    "quote",
    "authorName",
    "authorRole",
    "organization",
    "caseStudySlug",
    "displayOrder",
    "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(clientTestimonialsTable)
    .set(updates)
    .where(eq(clientTestimonialsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "client_testimonial.update",
    entity: "client_testimonial",
    entityId: id,
  });
  res.json(serializeTestimonial(updated));
});

router.delete("/cms/testimonials/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  await db
    .delete(clientTestimonialsTable)
    .where(eq(clientTestimonialsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "client_testimonial.delete",
    entity: "client_testimonial",
    entityId: id,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Partner descriptions
// ---------------------------------------------------------------------------

const PartnerBody = z.object({
  slug: z.string().nullish(),
  name: z.string().min(1),
  description: z.string().optional(),
  logo: z.string().nullish(),
  websiteUrl: z.string().nullish(),
  category: z.string().optional(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
const PartnerPatch = PartnerBody.partial();

router.get("/partners", async (req, res) => {
  const category =
    typeof req.query.category === "string" ? req.query.category : null;
  const whereClauses = [eq(partnerDescriptionsTable.active, true)];
  if (category)
    whereClauses.push(eq(partnerDescriptionsTable.category, category));
  const rows = await db
    .select()
    .from(partnerDescriptionsTable)
    .where(and(...whereClauses))
    .orderBy(
      asc(partnerDescriptionsTable.category),
      asc(partnerDescriptionsTable.displayOrder),
      asc(partnerDescriptionsTable.createdAt),
    );
  res.json({ items: rows.map(serializePartner) });
});

router.get("/cms/partners", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(partnerDescriptionsTable)
    .orderBy(
      asc(partnerDescriptionsTable.category),
      asc(partnerDescriptionsTable.displayOrder),
      asc(partnerDescriptionsTable.createdAt),
    );
  res.json({ items: rows.map(serializePartner) });
});

router.post("/cms/partners", ...adminGuard, async (req, res) => {
  const parsed = PartnerBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(partnerDescriptionsTable, d.slug || d.name);
  const [row] = await db
    .insert(partnerDescriptionsTable)
    .values({
      slug,
      name: d.name,
      description: d.description ?? "",
      logo: d.logo ?? null,
      websiteUrl: d.websiteUrl ?? null,
      category: d.category ?? "alliance",
      displayOrder: d.displayOrder ?? 0,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "partner.create",
    entity: "partner",
    entityId: row.id,
  });
  res.status(201).json(serializePartner(row));
});

router.patch("/cms/partners/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.partnerDescriptionsTable.findFirst({
    where: eq(partnerDescriptionsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = PartnerPatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueSlug(partnerDescriptionsTable, d.slug, id);
  }
  for (const k of [
    "name",
    "description",
    "logo",
    "websiteUrl",
    "category",
    "displayOrder",
    "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(partnerDescriptionsTable)
    .set(updates)
    .where(eq(partnerDescriptionsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "partner.update",
    entity: "partner",
    entityId: id,
  });
  res.json(serializePartner(updated));
});

router.delete("/cms/partners/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  await db
    .delete(partnerDescriptionsTable)
    .where(eq(partnerDescriptionsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "partner.delete",
    entity: "partner",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
