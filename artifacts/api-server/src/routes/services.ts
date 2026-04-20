import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, ne, asc } from "drizzle-orm";
import {
  db,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import {
  listServicesWithSolutions,
  getServiceWithMethodologies,
  getSolutionWithCapabilities,
  serializeService,
  serializeSolution,
  serializeMethodology,
  serializeCapability,
} from "../lib/servicesSerializer";

const router: IRouter = Router();

// ----- Public ------------------------------------------------------------

router.get("/services", async (_req, res) => {
  const items = await listServicesWithSolutions();
  res.json({ items });
});

router.get("/services/:slug", async (req, res) => {
  const result = await getServiceWithMethodologies(String(req.params.slug));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

router.get("/solutions/:slug", async (req, res) => {
  const result = await getSolutionWithCapabilities(String(req.params.slug));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

// ----- Admin -------------------------------------------------------------

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

async function ensureUniqueServiceSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.servicesTable.findFirst({
      where: excludeId
        ? and(eq(servicesTable.slug, slug), ne(servicesTable.id, excludeId))
        : eq(servicesTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

async function ensureUniqueSolutionSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.solutionsTable.findFirst({
      where: excludeId
        ? and(eq(solutionsTable.slug, slug), ne(solutionsTable.id, excludeId))
        : eq(solutionsTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

const ServiceBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  displayOrder: z.number().int().nullish(),
  iconId: z.string().uuid().nullish(),
  parentServiceId: z.string().uuid().nullish(),
  servicePath: z.string().nullish(),
  overviewPath: z.string().nullish(),
  buttonText: z.string().nullish(),
  heroTextHtml: z.string().nullish(),
  secondaryTitle: z.string().nullish(),
  secondaryTextHtml: z.string().nullish(),
  tertiaryTitle: z.string().nullish(),
  tertiaryTextHtml: z.string().nullish(),
  blurbHtml: z.string().nullish(),
  blogCategory: z.string().nullish(),
  active: z.boolean().optional(),
});
const ServicePatch = ServiceBody.partial();

const SolutionBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  displayOrder: z.number().int().nullish(),
  parentServiceId: z.string().uuid().nullish(),
  iconId: z.string().uuid().nullish(),
  routePath: z.string().nullish(),
  buttonText: z.string().nullish(),
  heroTextHtml: z.string().nullish(),
  secondaryTitle: z.string().nullish(),
  secondaryTextHtml: z.string().nullish(),
  ourApproachTitle: z.string().nullish(),
  ourApproachTextHtml: z.string().nullish(),
  blurbHtml: z.string().nullish(),
  blurbCopy: z.string().nullish(),
  heroTextColor: z.string().nullish(),
  tagsText: z.string().nullish(),
  blogCategory: z.string().nullish(),
  blogTag: z.string().nullish(),
  primaryBlogCategoryFilter: z.string().nullish(),
  buttonUrl: z.string().nullish(),
  active: z.boolean().optional(),
});
const SolutionPatch = SolutionBody.partial();

const MethodologyBody = z.object({
  serviceId: z.string().uuid(),
  title: z.string().min(1),
  displayOrder: z.number().int().optional(),
  iconId: z.string().uuid().nullish(),
  bodyHtml: z.string().nullish(),
  hidden: z.boolean().optional(),
});
const MethodologyPatch = MethodologyBody.partial();

const CapabilityBody = z.object({
  solutionId: z.string().uuid(),
  title: z.string().min(1),
  displayOrder: z.number().int().optional(),
  iconId: z.string().uuid().nullish(),
  bodyHtml: z.string().nullish(),
  hidden: z.boolean().optional(),
});
const CapabilityPatch = CapabilityBody.partial();

// --- admin: services list (includes inactive) ---
router.get("/cms/services", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(servicesTable)
    .orderBy(asc(servicesTable.displayOrder), asc(servicesTable.title));
  const visible = rows.filter((r) => !r.deletedAt);
  res.json({ items: await Promise.all(visible.map(serializeService)) });
});

router.post("/cms/services", ...adminGuard, async (req, res) => {
  const parsed = ServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueServiceSlug(d.slug || d.title);
  const [row] = await db
    .insert(servicesTable)
    .values({
      slug,
      title: d.title,
      displayOrder: d.displayOrder ?? null,
      iconId: d.iconId ?? null,
      parentServiceId: d.parentServiceId ?? null,
      servicePath: d.servicePath ?? null,
      overviewPath: d.overviewPath ?? null,
      buttonText: d.buttonText ?? null,
      heroTextHtml: d.heroTextHtml ?? null,
      secondaryTitle: d.secondaryTitle ?? null,
      secondaryTextHtml: d.secondaryTextHtml ?? null,
      tertiaryTitle: d.tertiaryTitle ?? null,
      tertiaryTextHtml: d.tertiaryTextHtml ?? null,
      blurbHtml: d.blurbHtml ?? null,
      blogCategory: d.blogCategory ?? null,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "service.create",
    entity: "service",
    entityId: row.id,
  });
  res.status(201).json(await serializeService(row));
});

router.patch("/cms/services/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = ServicePatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueServiceSlug(d.slug, id);
  }
  for (const k of [
    "title", "displayOrder", "iconId", "parentServiceId", "servicePath",
    "overviewPath", "buttonText", "heroTextHtml", "secondaryTitle",
    "secondaryTextHtml", "tertiaryTitle", "tertiaryTextHtml", "blurbHtml",
    "blogCategory", "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(servicesTable)
    .set(updates)
    .where(eq(servicesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "service.update",
    entity: "service",
    entityId: id,
  });
  res.json(await serializeService(updated));
});

router.delete("/cms/services/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(servicesTable)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(servicesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "service.delete",
    entity: "service",
    entityId: id,
  });
  res.status(204).end();
});

// --- admin: solutions ---
router.get("/cms/solutions", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(solutionsTable)
    .orderBy(asc(solutionsTable.displayOrder), asc(solutionsTable.title));
  const visible = rows.filter((r) => !r.deletedAt);
  res.json({ items: await Promise.all(visible.map(serializeSolution)) });
});

router.post("/cms/solutions", ...adminGuard, async (req, res) => {
  const parsed = SolutionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSolutionSlug(d.slug || d.title);
  const [row] = await db
    .insert(solutionsTable)
    .values({
      slug,
      title: d.title,
      displayOrder: d.displayOrder ?? null,
      parentServiceId: d.parentServiceId ?? null,
      iconId: d.iconId ?? null,
      routePath: d.routePath ?? null,
      buttonText: d.buttonText ?? null,
      heroTextHtml: d.heroTextHtml ?? null,
      secondaryTitle: d.secondaryTitle ?? null,
      secondaryTextHtml: d.secondaryTextHtml ?? null,
      ourApproachTitle: d.ourApproachTitle ?? null,
      ourApproachTextHtml: d.ourApproachTextHtml ?? null,
      blurbHtml: d.blurbHtml ?? null,
      blurbCopy: d.blurbCopy ?? null,
      heroTextColor: d.heroTextColor ?? null,
      tagsText: d.tagsText ?? null,
      blogCategory: d.blogCategory ?? null,
      blogTag: d.blogTag ?? null,
      primaryBlogCategoryFilter: d.primaryBlogCategoryFilter ?? null,
      buttonUrl: d.buttonUrl ?? null,
      active: d.active ?? true,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "solution.create",
    entity: "solution",
    entityId: row.id,
  });
  res.status(201).json(await serializeSolution(row));
});

router.patch("/cms/solutions/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.solutionsTable.findFirst({ where: eq(solutionsTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = SolutionPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueSolutionSlug(d.slug, id);
  }
  for (const k of [
    "title", "displayOrder", "parentServiceId", "iconId", "routePath",
    "buttonText", "heroTextHtml", "secondaryTitle", "secondaryTextHtml",
    "ourApproachTitle", "ourApproachTextHtml", "blurbHtml", "blurbCopy",
    "heroTextColor", "tagsText", "blogCategory", "blogTag",
    "primaryBlogCategoryFilter", "buttonUrl", "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(solutionsTable)
    .set(updates)
    .where(eq(solutionsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "solution.update",
    entity: "solution",
    entityId: id,
  });
  res.json(await serializeSolution(updated));
});

router.delete("/cms/solutions/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.solutionsTable.findFirst({ where: eq(solutionsTable.id, id) });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(solutionsTable)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(solutionsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "solution.delete",
    entity: "solution",
    entityId: id,
  });
  res.status(204).end();
});

// --- admin: methodologies (scoped to a service) ---
router.get("/cms/services/:serviceId/methodologies", ...readGuard, async (req, res) => {
  const serviceId = String(req.params.serviceId);
  const rows = await db
    .select()
    .from(serviceMethodologiesTable)
    .where(eq(serviceMethodologiesTable.serviceId, serviceId))
    .orderBy(asc(serviceMethodologiesTable.displayOrder), asc(serviceMethodologiesTable.title));
  res.json({ items: await Promise.all(rows.map(serializeMethodology)) });
});

router.post("/cms/methodologies", ...adminGuard, async (req, res) => {
  const parsed = MethodologyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(serviceMethodologiesTable)
    .values({
      serviceId: d.serviceId,
      title: d.title,
      displayOrder: d.displayOrder ?? 0,
      iconId: d.iconId ?? null,
      bodyHtml: d.bodyHtml ?? null,
      hidden: d.hidden ?? false,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "methodology.create",
    entity: "methodology",
    entityId: row.id,
  });
  res.status(201).json(await serializeMethodology(row));
});

router.patch("/cms/methodologies/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.serviceMethodologiesTable.findFirst({
    where: eq(serviceMethodologiesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = MethodologyPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["serviceId", "title", "displayOrder", "iconId", "bodyHtml", "hidden"] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(serviceMethodologiesTable)
    .set(updates)
    .where(eq(serviceMethodologiesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "methodology.update",
    entity: "methodology",
    entityId: id,
  });
  res.json(await serializeMethodology(updated));
});

router.delete("/cms/methodologies/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.serviceMethodologiesTable.findFirst({
    where: eq(serviceMethodologiesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(serviceMethodologiesTable).where(eq(serviceMethodologiesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "methodology.delete",
    entity: "methodology",
    entityId: id,
  });
  res.status(204).end();
});

// --- admin: capabilities (scoped to a solution) ---
router.get("/cms/solutions/:solutionId/capabilities", ...readGuard, async (req, res) => {
  const solutionId = String(req.params.solutionId);
  const rows = await db
    .select()
    .from(solutionCapabilitiesTable)
    .where(eq(solutionCapabilitiesTable.solutionId, solutionId))
    .orderBy(asc(solutionCapabilitiesTable.displayOrder), asc(solutionCapabilitiesTable.title));
  res.json({ items: await Promise.all(rows.map(serializeCapability)) });
});

router.post("/cms/capabilities", ...adminGuard, async (req, res) => {
  const parsed = CapabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(solutionCapabilitiesTable)
    .values({
      solutionId: d.solutionId,
      title: d.title,
      displayOrder: d.displayOrder ?? 0,
      iconId: d.iconId ?? null,
      bodyHtml: d.bodyHtml ?? null,
      hidden: d.hidden ?? false,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "capability.create",
    entity: "capability",
    entityId: row.id,
  });
  res.status(201).json(await serializeCapability(row));
});

router.patch("/cms/capabilities/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.solutionCapabilitiesTable.findFirst({
    where: eq(solutionCapabilitiesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = CapabilityPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["solutionId", "title", "displayOrder", "iconId", "bodyHtml", "hidden"] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  const [updated] = await db
    .update(solutionCapabilitiesTable)
    .set(updates)
    .where(eq(solutionCapabilitiesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "capability.update",
    entity: "capability",
    entityId: id,
  });
  res.json(await serializeCapability(updated));
});

router.delete("/cms/capabilities/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.solutionCapabilitiesTable.findFirst({
    where: eq(solutionCapabilitiesTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(solutionCapabilitiesTable).where(eq(solutionCapabilitiesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "capability.delete",
    entity: "capability",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
