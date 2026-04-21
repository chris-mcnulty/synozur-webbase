import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  caseStudiesTable,
  ARTIFACT_STATUSES,
  type CaseStudy,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import {
  upsertCollateralFromCaseStudy,
  softDeleteCollateralForCaseStudy,
} from "../lib/syncCollateral";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth, requireRole("admin", "editor")];

async function ensureUniqueCaseStudySlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const found = await db.query.caseStudiesTable.findFirst({
      where: excludeId
        ? and(eq(caseStudiesTable.slug, slug), ne(caseStudiesTable.id, excludeId))
        : eq(caseStudiesTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(c: CaseStudy) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    client: c.client,
    clientLabel: c.clientLabel,
    industry: c.industry,
    established: c.established,
    tag: c.tag,
    headline: c.headline,
    summary: c.summary,
    heroImage: c.heroImage,
    clientLogo: c.clientLogo,
    challenge: c.challenge,
    approach: c.approach,
    outcome: c.outcome,
    metrics: c.metrics,
    quote: { text: c.quoteText, attribution: c.quoteAttribution },
    serviceId: c.serviceId,
    solutionId: c.solutionId,
    status: c.status,
    publishedAt: c.publishedAt,
    unpublishedAt: c.unpublishedAt,
    featured: c.featured,
    featuredRank: c.featuredRank,
    seoTitle: c.seoTitle,
    seoDescription: c.seoDescription,
    ogImage: c.ogImage,
    active: c.active,
    sourceId: c.sourceId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ----- Public ------------------------------------------------------------

router.get("/case-studies", async (req, res) => {
  const industry =
    typeof req.query.industry === "string" ? req.query.industry : null;
  const tag = typeof req.query.tag === "string" ? req.query.tag : null;
  const serviceId =
    typeof req.query.serviceId === "string" ? req.query.serviceId : null;
  const solutionId =
    typeof req.query.solutionId === "string" ? req.query.solutionId : null;

  const whereClauses = [
    eq(caseStudiesTable.active, true),
    eq(caseStudiesTable.status, "published"),
    sql`${caseStudiesTable.deletedAt} is null`,
    sql`(${caseStudiesTable.publishedAt} is null or ${caseStudiesTable.publishedAt} <= now())`,
    sql`(${caseStudiesTable.unpublishedAt} is null or ${caseStudiesTable.unpublishedAt} > now())`,
  ];
  if (industry) whereClauses.push(eq(caseStudiesTable.industry, industry));
  if (tag) whereClauses.push(eq(caseStudiesTable.tag, tag));
  if (serviceId) whereClauses.push(eq(caseStudiesTable.serviceId, serviceId));
  if (solutionId)
    whereClauses.push(eq(caseStudiesTable.solutionId, solutionId));

  const rows = await db
    .select()
    .from(caseStudiesTable)
    .where(and(...whereClauses))
    .orderBy(
      desc(caseStudiesTable.featured),
      sql`${caseStudiesTable.featuredRank} asc nulls last`,
      desc(caseStudiesTable.publishedAt),
      desc(caseStudiesTable.createdAt),
    );
  res.json({ items: rows.map(serialize) });
});

router.get("/case-studies/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.caseStudiesTable.findFirst({
    where: and(
      eq(caseStudiesTable.slug, slug),
      eq(caseStudiesTable.active, true),
      eq(caseStudiesTable.status, "published"),
      sql`${caseStudiesTable.deletedAt} is null`,
      sql`(${caseStudiesTable.publishedAt} is null or ${caseStudiesTable.publishedAt} <= now())`,
      sql`(${caseStudiesTable.unpublishedAt} is null or ${caseStudiesTable.unpublishedAt} > now())`,
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ----- Admin -------------------------------------------------------------

const MetricSchema = z.object({
  label: z.string(),
  value: z.string(),
});
const SectionSchema = z.object({
  heading: z.string(),
  body: z.array(z.string()),
  bullets: z.array(z.string()).optional(),
});

const CaseStudyBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  client: z.string().optional(),
  clientLabel: z.string().optional(),
  industry: z.string().optional(),
  established: z.string().nullish(),
  tag: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  heroImage: z.string().optional(),
  clientLogo: z.string().nullish(),
  challenge: SectionSchema.optional(),
  approach: z.array(SectionSchema).optional(),
  outcome: SectionSchema.optional(),
  metrics: z.array(MetricSchema).optional(),
  quote: z.object({ text: z.string(), attribution: z.string() }).optional(),
  serviceId: z.string().uuid().nullish(),
  solutionId: z.string().uuid().nullish(),
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
const CaseStudyPatch = CaseStudyBody.partial();

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cms/case-studies", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(caseStudiesTable)
    .where(sql`${caseStudiesTable.deletedAt} is null`)
    .orderBy(
      desc(caseStudiesTable.publishedAt),
      desc(caseStudiesTable.createdAt),
    );
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/case-studies/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.caseStudiesTable.findFirst({
    where: eq(caseStudiesTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/case-studies", ...adminGuard, async (req, res) => {
  const parsed = CaseStudyBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueCaseStudySlug(d.slug || d.title);
  const [row] = await db
    .insert(caseStudiesTable)
    .values({
      slug,
      title: d.title,
      client: d.client ?? "",
      clientLabel: d.clientLabel ?? d.client ?? "",
      industry: d.industry ?? "",
      established: d.established ?? null,
      tag: d.tag ?? "",
      headline: d.headline ?? "",
      summary: d.summary ?? "",
      heroImage: d.heroImage ?? "",
      clientLogo: d.clientLogo ?? null,
      challenge: d.challenge ?? { heading: "The challenge", body: [] },
      approach: d.approach ?? [],
      outcome: d.outcome ?? { heading: "The outcome", body: [] },
      metrics: d.metrics ?? [],
      quoteText: d.quote?.text ?? "",
      quoteAttribution: d.quote?.attribution ?? "",
      serviceId: d.serviceId ?? null,
      solutionId: d.solutionId ?? null,
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
  await audit({
    actorId: req.authedUser!.id,
    action: "case_study.create",
    entity: "case_study",
    entityId: row.id,
  });
  try {
    await upsertCollateralFromCaseStudy(row);
  } catch (err) {
    req.log.error(
      { err, caseStudyId: row.id },
      "Failed to sync collateral after case study create",
    );
  }
  res.status(201).json(serialize(row));
});

router.patch("/cms/case-studies/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.caseStudiesTable.findFirst({
    where: eq(caseStudiesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = CaseStudyPatch.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueCaseStudySlug(d.slug, id);
  }
  for (const k of [
    "title",
    "client",
    "clientLabel",
    "industry",
    "established",
    "tag",
    "headline",
    "summary",
    "heroImage",
    "clientLogo",
    "challenge",
    "approach",
    "outcome",
    "metrics",
    "serviceId",
    "solutionId",
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
  if (d.quote !== undefined) {
    updates.quoteText = d.quote.text;
    updates.quoteAttribution = d.quote.attribution;
  }
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined)
    updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(caseStudiesTable)
    .set(updates)
    .where(eq(caseStudiesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "case_study.update",
    entity: "case_study",
    entityId: id,
  });
  try {
    await upsertCollateralFromCaseStudy(updated);
  } catch (err) {
    req.log.error(
      { err, caseStudyId: updated.id },
      "Failed to sync collateral after case study update",
    );
  }
  res.json(serialize(updated));
});

router.delete("/cms/case-studies/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.caseStudiesTable.findFirst({
    where: eq(caseStudiesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(caseStudiesTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(caseStudiesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "case_study.delete",
    entity: "case_study",
    entityId: id,
  });
  try {
    await softDeleteCollateralForCaseStudy(id);
  } catch (err) {
    req.log.error(
      { err, caseStudyId: id },
      "Failed to soft-delete collateral after case study delete",
    );
  }
  res.status(204).end();
});

router.post(
  "/cms/case-studies/:id/sync-to-collateral",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const row = await db.query.caseStudiesTable.findFirst({
      where: eq(caseStudiesTable.id, id),
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await upsertCollateralFromCaseStudy(row);
    res.json({ ok: true });
  },
);

export default router;
