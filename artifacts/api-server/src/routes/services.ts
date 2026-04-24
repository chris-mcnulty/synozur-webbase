import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, ne, asc, desc, sql } from "drizzle-orm";
import {
  db,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
  serviceRevisionsTable,
  solutionRevisionsTable,
  usersTable,
  ARTIFACT_STATUSES,
  COLLATERAL_PILLARS,
  type Service,
  type Solution,
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
  setEntityTags,
} from "../lib/servicesSerializer";
import { signPreviewToken, verifyPreviewToken } from "../lib/previewToken";

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const router: IRouter = Router();

// ----- Public ------------------------------------------------------------

router.get("/services", async (_req, res) => {
  const items = await listServicesWithSolutions();
  res.json({ items });
});

router.get("/services/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const previewToken =
    typeof req.query["preview"] === "string" ? req.query["preview"] : null;
  let preview = false;
  if (previewToken) {
    const row = await db.query.servicesTable.findFirst({
      where: eq(servicesTable.slug, slug),
    });
    preview = Boolean(row && verifyPreviewToken(previewToken, "service", row.id));
  }
  const result = await getServiceWithMethodologies(slug, { preview });
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

router.get("/solutions/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const previewToken =
    typeof req.query["preview"] === "string" ? req.query["preview"] : null;
  let preview = false;
  if (previewToken) {
    const row = await db.query.solutionsTable.findFirst({
      where: eq(solutionsTable.slug, slug),
    });
    preview = Boolean(row && verifyPreviewToken(previewToken, "solution", row.id));
  }
  const result = await getSolutionWithCapabilities(slug, { preview });
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
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  status: z.enum(ARTIFACT_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
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
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  status: z.enum(ARTIFACT_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  pillar: z.enum(COLLATERAL_PILLARS).nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
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
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
      status: d.status ?? "draft",
      publishedAt: parseDate(d.publishedAt),
      unpublishedAt: parseDate(d.unpublishedAt),
      active: d.active ?? true,
    })
    .returning();
  if (d.tagIds) {
    await setEntityTags("service", row.id, d.tagIds);
  }
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
    "blogCategory", "seoTitle", "seoDescription", "status", "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);
  // #61: snapshot prior state before overwriting — both ops in one transaction
  // so a failed update cannot leave an orphan revision row.
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(serviceRevisionsTable).values({
      serviceId: id,
      snapshotJson: existing as never,
      editedBy: req.authedUser!.id,
    });
    return tx
      .update(servicesTable)
      .set(updates)
      .where(eq(servicesTable.id, id))
      .returning();
  });
  if (d.tagIds !== undefined) {
    await setEntityTags("service", id, d.tagIds);
  }
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
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
      status: d.status ?? "draft",
      publishedAt: parseDate(d.publishedAt),
      unpublishedAt: parseDate(d.unpublishedAt),
      pillar: d.pillar ?? null,
      active: d.active ?? true,
    })
    .returning();
  if (d.tagIds) {
    await setEntityTags("solution", row.id, d.tagIds);
  }
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
    "primaryBlogCategoryFilter", "buttonUrl", "seoTitle", "seoDescription",
    "status", "pillar", "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);
  // #61: snapshot prior state before overwriting — both ops in one transaction
  // so a failed update cannot leave an orphan revision row.
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(solutionRevisionsTable).values({
      solutionId: id,
      snapshotJson: existing as never,
      editedBy: req.authedUser!.id,
    });
    return tx
      .update(solutionsTable)
      .set(updates)
      .where(eq(solutionsTable.id, id))
      .returning();
  });
  if (d.tagIds !== undefined) {
    await setEntityTags("solution", id, d.tagIds);
  }
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

// #61: revision history for services and solutions. Mirrors the post
// revision system: GET lists snapshots newest-first with editor + title
// metadata; POST /.../restore snapshots current state into a new revision
// and then overwrites the row with the historical content-only fields
// (status/slug/active/publishedAt/... are preserved on purpose, so a
// restore never republishes or retitles the public URL).

type ServiceRow = Service;
type SolutionRow = Solution;

const SERVICE_RESTORABLE_FIELDS = [
  "title",
  "displayOrder",
  "iconId",
  "parentServiceId",
  "servicePath",
  "overviewPath",
  "buttonText",
  "heroTextHtml",
  "secondaryTitle",
  "secondaryTextHtml",
  "tertiaryTitle",
  "tertiaryTextHtml",
  "blurbHtml",
  "blogCategory",
  "seoTitle",
  "seoDescription",
] as const;

const SOLUTION_RESTORABLE_FIELDS = [
  "title",
  "displayOrder",
  "parentServiceId",
  "iconId",
  "routePath",
  "buttonText",
  "heroTextHtml",
  "secondaryTitle",
  "secondaryTextHtml",
  "ourApproachTitle",
  "ourApproachTextHtml",
  "blurbHtml",
  "blurbCopy",
  "heroTextColor",
  "tagsText",
  "blogCategory",
  "blogTag",
  "primaryBlogCategoryFilter",
  "buttonUrl",
  "seoTitle",
  "seoDescription",
  "pillar",
] as const;

router.get("/cms/services/:id/revisions", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) });
  if (!service || service.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      id: serviceRevisionsTable.id,
      serviceId: serviceRevisionsTable.serviceId,
      editedAt: serviceRevisionsTable.editedAt,
      editorId: usersTable.id,
      editorDisplayName: usersTable.displayName,
      editorAvatarUrl: usersTable.avatarUrl,
      snapshotTitle: sql<string | null>`${serviceRevisionsTable.snapshotJson}->>'title'`,
      snapshotStatus: sql<string | null>`${serviceRevisionsTable.snapshotJson}->>'status'`,
    })
    .from(serviceRevisionsTable)
    .leftJoin(usersTable, eq(usersTable.id, serviceRevisionsTable.editedBy))
    .where(eq(serviceRevisionsTable.serviceId, id))
    .orderBy(desc(serviceRevisionsTable.editedAt));
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      serviceId: r.serviceId,
      editedAt: r.editedAt.toISOString(),
      editor: r.editorId
        ? {
            id: r.editorId,
            displayName: r.editorDisplayName ?? null,
            avatarUrl: r.editorAvatarUrl ?? null,
          }
        : null,
      snapshotTitle: r.snapshotTitle ?? null,
      snapshotStatus: r.snapshotStatus ?? null,
    })),
  });
});

router.post(
  "/cms/services/:id/revisions/:revisionId/restore",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const revisionId = String(req.params.revisionId);
    const service = await db.query.servicesTable.findFirst({
      where: eq(servicesTable.id, id),
    });
    if (!service || service.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const revision = await db.query.serviceRevisionsTable.findFirst({
      where: and(
        eq(serviceRevisionsTable.id, revisionId),
        eq(serviceRevisionsTable.serviceId, id),
      ),
    });
    if (!revision) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const snap = (revision.snapshotJson ?? {}) as Partial<ServiceRow>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of SERVICE_RESTORABLE_FIELDS) {
      if (field in snap) {
        updates[field] = (snap as Record<string, unknown>)[field] ?? null;
      }
    }
    const [updated] = await db.transaction(async (tx) => {
      await tx.insert(serviceRevisionsTable).values({
        serviceId: id,
        snapshotJson: service as never,
        editedBy: req.authedUser!.id,
      });
      return tx
        .update(servicesTable)
        .set(updates)
        .where(eq(servicesTable.id, id))
        .returning();
    });
    await audit({
      actorId: req.authedUser!.id,
      action: "service.restore_revision",
      entity: "service",
      entityId: id,
      diff: { revisionId },
    });
    res.json(await serializeService(updated));
  },
);

router.get("/cms/solutions/:id/revisions", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const solution = await db.query.solutionsTable.findFirst({
    where: eq(solutionsTable.id, id),
  });
  if (!solution || solution.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      id: solutionRevisionsTable.id,
      solutionId: solutionRevisionsTable.solutionId,
      editedAt: solutionRevisionsTable.editedAt,
      editorId: usersTable.id,
      editorDisplayName: usersTable.displayName,
      editorAvatarUrl: usersTable.avatarUrl,
      snapshotTitle: sql<string | null>`${solutionRevisionsTable.snapshotJson}->>'title'`,
      snapshotStatus: sql<string | null>`${solutionRevisionsTable.snapshotJson}->>'status'`,
    })
    .from(solutionRevisionsTable)
    .leftJoin(usersTable, eq(usersTable.id, solutionRevisionsTable.editedBy))
    .where(eq(solutionRevisionsTable.solutionId, id))
    .orderBy(desc(solutionRevisionsTable.editedAt));
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      solutionId: r.solutionId,
      editedAt: r.editedAt.toISOString(),
      editor: r.editorId
        ? {
            id: r.editorId,
            displayName: r.editorDisplayName ?? null,
            avatarUrl: r.editorAvatarUrl ?? null,
          }
        : null,
      snapshotTitle: r.snapshotTitle ?? null,
      snapshotStatus: r.snapshotStatus ?? null,
    })),
  });
});

router.post(
  "/cms/solutions/:id/revisions/:revisionId/restore",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const revisionId = String(req.params.revisionId);
    const solution = await db.query.solutionsTable.findFirst({
      where: eq(solutionsTable.id, id),
    });
    if (!solution || solution.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const revision = await db.query.solutionRevisionsTable.findFirst({
      where: and(
        eq(solutionRevisionsTable.id, revisionId),
        eq(solutionRevisionsTable.solutionId, id),
      ),
    });
    if (!revision) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const snap = (revision.snapshotJson ?? {}) as Partial<SolutionRow>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of SOLUTION_RESTORABLE_FIELDS) {
      if (field in snap) {
        updates[field] = (snap as Record<string, unknown>)[field] ?? null;
      }
    }
    const [updated] = await db.transaction(async (tx) => {
      await tx.insert(solutionRevisionsTable).values({
        solutionId: id,
        snapshotJson: solution as never,
        editedBy: req.authedUser!.id,
      });
      return tx
        .update(solutionsTable)
        .set(updates)
        .where(eq(solutionsTable.id, id))
        .returning();
    });
    await audit({
      actorId: req.authedUser!.id,
      action: "solution.restore_revision",
      entity: "solution",
      entityId: id,
      diff: { revisionId },
    });
    res.json(await serializeSolution(updated));
  },
);

// #60: mint a short-lived preview token so an editor can view the draft
// service or solution on its public detail page. The returned URL uses
// `routePath`/slug-based path convention; the public page reads the
// `?preview=` query and hands it to the API.
router.post("/cms/services/:id/preview-token", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const service = await db.query.servicesTable.findFirst({ where: eq(servicesTable.id, id) });
  if (!service || service.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { token, expiresAt } = signPreviewToken("service", service.id);
  await audit({
    actorId: req.authedUser!.id,
    action: "service.preview_token",
    entity: "service",
    entityId: service.id,
  });
  res.json({
    token,
    expiresAt: expiresAt.toISOString(),
    slug: service.slug,
    previewPath: `/services/${service.slug}?preview=${encodeURIComponent(token)}`,
  });
});

router.post("/cms/solutions/:id/preview-token", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const solution = await db.query.solutionsTable.findFirst({
    where: eq(solutionsTable.id, id),
  });
  if (!solution || solution.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { token, expiresAt } = signPreviewToken("solution", solution.id);
  await audit({
    actorId: req.authedUser!.id,
    action: "solution.preview_token",
    entity: "solution",
    entityId: solution.id,
  });
  res.json({
    token,
    expiresAt: expiresAt.toISOString(),
    slug: solution.slug,
    previewPath: `/solutions/${solution.slug}?preview=${encodeURIComponent(token)}`,
  });
});

export default router;
