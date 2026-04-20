import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, isNull, ne, asc } from "drizzle-orm";
import { db, workshopsTable, type Workshop } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";

const router: IRouter = Router();

// ---- Zod sub-schemas (match Workshop type) -----------------------------

const CtaSchema = z.object({
  label: z.string().default(""),
  href: z.string().default(""),
});

const PainSchema = z.object({
  header: z.string().default(""),
  lead: z.string().default(""),
  tiles: z.array(z.string()).default([]),
});

const ScopeSchema = z.object({
  header: z.string().default(""),
  summary: z.string().default(""),
  bullets: z.array(z.string()).default([]),
  included: z.array(z.string()).default([]),
});

const ProcessSchema = z.object({
  header: z.string().default(""),
  steps: z.array(z.string()).default([]),
});

const DeliverablesSchema = z.object({
  header: z.string().default(""),
  core: z.array(z.string()).default([]),
  executive: z.array(z.string()).default([]),
  enablement: z.array(z.string()).default([]),
  addOns: z.array(z.string()).default([]),
});

const PriceSchema = z.object({
  label: z.string().default(""),
  startingAt: z.number().nullish(),
  display: z.string().default(""),
  timeline: z.string().default(""),
  whatIsIncluded: z.array(z.string()).default([]),
});

const DiagnosticSchema = z.object({
  header: z.string().default(""),
  summary: z.string().default(""),
  whatWeAssess: z.array(z.string()).default([]),
  questionnairePreview: z.array(z.string()).default([]),
  sampleOutputLink: z.string().nullish(),
});

const CompetitiveIntelSchema = z.object({
  header: z.string().default(""),
  summary: z.string().default(""),
  outputs: z.array(z.string()).default([]),
});

const OutcomesSchema = z.object({
  header: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});

const SampleDeliverablesSchema = z.object({
  header: z.string().default(""),
  link: z.string().nullish(),
  thumbs: z.array(z.string()).default([]),
});

const FaqSchema = z.object({
  header: z.string().default(""),
  items: z
    .array(z.object({ q: z.string(), a: z.string() }))
    .default([]),
});

const SeoSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
});

const WorkshopBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  category: z.string().default(""),
  shortDescription: z.string().default(""),
  heroHeadline: z.string().default(""),
  heroSubhead: z.string().default(""),
  heroImage: z.string().default(""),
  heroTrustBullets: z.array(z.string()).default([]),
  primaryCTA: CtaSchema.default({ label: "", href: "" }),
  secondaryCTA: CtaSchema.nullish(),
  deliveryFormat: z.string().default(""),
  duration: z.string().default(""),
  whoItsFor: z.array(z.string()).default([]),
  idealParticipants: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  pain: PainSchema.default({ header: "", lead: "", tiles: [] }),
  scope: ScopeSchema.default({ header: "", summary: "", bullets: [], included: [] }),
  process: ProcessSchema.default({ header: "", steps: [] }),
  deliverables: DeliverablesSchema.default({
    header: "",
    core: [],
    executive: [],
    enablement: [],
    addOns: [],
  }),
  price: PriceSchema.default({
    label: "",
    display: "",
    timeline: "",
    whatIsIncluded: [],
  }),
  diagnostic: DiagnosticSchema.nullish(),
  competitiveIntel: CompetitiveIntelSchema.nullish(),
  toolingNote: z.string().nullish(),
  outcomes: OutcomesSchema.default({ header: "", bullets: [] }),
  beforeExample: z.string().default(""),
  afterExample: z.string().default(""),
  sampleDeliverables: SampleDeliverablesSchema.default({ header: "", thumbs: [] }),
  faq: FaqSchema.default({ header: "", items: [] }),
  seo: SeoSchema.default({ title: "", description: "" }),
  displayOrder: z.number().int().nullish(),
  active: z.boolean().optional(),
});
type WorkshopBodyT = z.infer<typeof WorkshopBody>;
const WorkshopPatch = WorkshopBody.partial().extend({
  primaryCTA: CtaSchema.partial().optional(),
  secondaryCTA: CtaSchema.partial().optional(),
  pain: PainSchema.partial().optional(),
  scope: ScopeSchema.partial().optional(),
  process: ProcessSchema.partial().optional(),
  deliverables: DeliverablesSchema.partial().optional(),
  price: PriceSchema.partial().optional(),
  diagnostic: DiagnosticSchema.partial().nullish(),
  competitiveIntel: CompetitiveIntelSchema.partial().nullish(),
  outcomes: OutcomesSchema.partial().optional(),
  sampleDeliverables: SampleDeliverablesSchema.partial().optional(),
  faq: FaqSchema.partial().optional(),
  seo: SeoSchema.partial().optional(),
});

// ---- Serializer --------------------------------------------------------

function shape(w: Workshop) {
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    category: w.category,
    shortDescription: w.shortDescription,
    heroHeadline: w.heroHeadline,
    heroSubhead: w.heroSubhead,
    heroImage: w.heroImage,
    heroTrustBullets: w.heroTrustBullets,
    primaryCTA: w.primaryCTA,
    secondaryCTA: w.secondaryCTA,
    deliveryFormat: w.deliveryFormat,
    duration: w.duration,
    whoItsFor: w.whoItsFor,
    idealParticipants: w.idealParticipants,
    prerequisites: w.prerequisites,
    pain: w.pain,
    scope: w.scope,
    process: w.process,
    deliverables: w.deliverables,
    price: w.price,
    diagnostic: w.diagnostic,
    competitiveIntel: w.competitiveIntel,
    toolingNote: w.toolingNote,
    outcomes: w.outcomes,
    beforeExample: w.beforeExample,
    afterExample: w.afterExample,
    sampleDeliverables: w.sampleDeliverables,
    faq: w.faq,
    seo: w.seo,
    displayOrder: w.displayOrder,
    sourceId: w.sourceId,
    active: w.active,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export type WorkshopDto = ReturnType<typeof shape>;

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.workshopsTable.findFirst({
      where: excludeId
        ? and(eq(workshopsTable.slug, slug), ne(workshopsTable.id, excludeId))
        : eq(workshopsTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function valuesFromBody(d: WorkshopBodyT, slug: string) {
  return {
    slug,
    title: d.title,
    category: d.category,
    shortDescription: d.shortDescription,
    heroHeadline: d.heroHeadline,
    heroSubhead: d.heroSubhead,
    heroImage: d.heroImage,
    heroTrustBullets: d.heroTrustBullets,
    primaryCTA: d.primaryCTA,
    secondaryCTA: d.secondaryCTA ?? null,
    deliveryFormat: d.deliveryFormat,
    duration: d.duration,
    whoItsFor: d.whoItsFor,
    idealParticipants: d.idealParticipants,
    prerequisites: d.prerequisites,
    pain: d.pain,
    scope: d.scope,
    process: d.process,
    deliverables: d.deliverables,
    price: d.price,
    diagnostic: d.diagnostic ?? null,
    competitiveIntel: d.competitiveIntel ?? null,
    toolingNote: d.toolingNote ?? null,
    outcomes: d.outcomes,
    beforeExample: d.beforeExample,
    afterExample: d.afterExample,
    sampleDeliverables: d.sampleDeliverables,
    faq: d.faq,
    seo: d.seo,
    displayOrder: d.displayOrder ?? null,
    active: d.active ?? true,
  };
}

// ---- Public ------------------------------------------------------------

router.get("/workshops", async (_req, res) => {
  const rows = await db
    .select()
    .from(workshopsTable)
    .where(and(eq(workshopsTable.active, true), isNull(workshopsTable.deletedAt)))
    .orderBy(asc(workshopsTable.displayOrder), asc(workshopsTable.title));
  res.json({ items: rows.map(shape) });
});

router.get("/workshops/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.workshopsTable.findFirst({
    where: eq(workshopsTable.slug, slug),
  });
  if (!row || row.deletedAt || !row.active) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shape(row));
});

// ---- Admin -------------------------------------------------------------

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

router.get("/cms/workshops", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(workshopsTable)
    .where(isNull(workshopsTable.deletedAt))
    .orderBy(asc(workshopsTable.displayOrder), asc(workshopsTable.title));
  res.json({ items: rows.map(shape) });
});

router.get("/cms/workshops/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.workshopsTable.findFirst({
    where: eq(workshopsTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shape(row));
});

router.post("/cms/workshops", ...adminGuard, async (req, res) => {
  const parsed = WorkshopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(d.slug || d.title);
  const [row] = await db
    .insert(workshopsTable)
    .values(valuesFromBody(d, slug))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "workshop.create",
    entity: "workshop",
    entityId: row.id,
  });
  res.status(201).json(shape(row));
});

router.patch("/cms/workshops/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.workshopsTable.findFirst({
    where: eq(workshopsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = WorkshopPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined) {
    const requestedSlug = typeof d.slug === "string" ? d.slug.trim() : "";
    if (requestedSlug) {
      updates.slug = await ensureUniqueSlug(requestedSlug, id);
    } else if (typeof d.title === "string") {
      updates.slug = await ensureUniqueSlug(toSlug(d.title), id);
    }
  }
  for (const k of [
    "title", "category", "shortDescription", "heroHeadline", "heroSubhead",
    "heroImage", "heroTrustBullets", "primaryCTA", "deliveryFormat", "duration",
    "whoItsFor", "idealParticipants", "prerequisites", "pain", "scope",
    "process", "deliverables", "price", "outcomes", "beforeExample",
    "afterExample", "sampleDeliverables", "faq", "seo", "displayOrder", "active",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  // Nullable fields — treat undefined as no-op, explicit null as clear.
  for (const k of ["secondaryCTA", "diagnostic", "competitiveIntel", "toolingNote"] as const) {
    if (k in d) updates[k] = d[k] ?? null;
  }
  const [updated] = await db
    .update(workshopsTable)
    .set(updates)
    .where(eq(workshopsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "workshop.update",
    entity: "workshop",
    entityId: id,
  });
  res.json(shape(updated));
});

router.delete("/cms/workshops/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.workshopsTable.findFirst({
    where: eq(workshopsTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(workshopsTable)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(workshopsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "workshop.delete",
    entity: "workshop",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
