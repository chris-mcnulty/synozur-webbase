import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  postsTable,
  servicesTable,
  solutionsTable,
  applicationsTable,
  caseStudiesTable,
  modelsTable,
  mediaTable,
} from "@workspace/db";

// #SEO: audit + autofill across every public artifact table. Reads the same
// published-only predicates used by the sitemap so the audit surface matches
// what actually ships to search engines.

export type ArtifactKind =
  | "insight"
  | "service"
  | "solution"
  | "application"
  | "case-study"
  | "model";

export interface AuditFinding {
  kind: ArtifactKind;
  id: string;
  slug: string;
  title: string;
  path: string;
  missing: string[];
  suggested: {
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
  };
}

export interface AuditReport {
  generatedAt: string;
  totals: Record<ArtifactKind, { total: number; missing: number }>;
  findings: AuditFinding[];
}

const MIN_DESCRIPTION = 70;
const MAX_DESCRIPTION = 160;
const MAX_TITLE = 65;

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clamp a plain-text description into the SERP-friendly length window. */
export function clampDescription(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (text.length <= MAX_DESCRIPTION) return text;
  const hard = text.slice(0, MAX_DESCRIPTION);
  const cut = hard.lastIndexOf(" ");
  const base = cut > MIN_DESCRIPTION ? hard.slice(0, cut) : hard;
  return base.replace(/[.,;:!?\-\s]+$/u, "") + "…";
}

function clampTitle(raw: string): string {
  const text = raw.trim();
  if (text.length <= MAX_TITLE) return text;
  const hard = text.slice(0, MAX_TITLE);
  const cut = hard.lastIndexOf(" ");
  return (cut > 30 ? hard.slice(0, cut) : hard).replace(/[\s\-–—]+$/u, "") + "…";
}

function firstNonEmpty(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (v) return v;
  }
  return "";
}

function suggestDescription(sources: Array<string | null | undefined>): string {
  const merged = sources
    .map((s) => stripHtml(s ?? ""))
    .filter((s) => s.length > 0)
    .join(" ");
  return clampDescription(merged);
}

/**
 * Build an audit finding for a row. `missing` lists fields that are blank
 * AND for which we have a non-empty suggestion; rows with nothing missing
 * are filtered out by the caller.
 */
function buildFinding(args: {
  kind: ArtifactKind;
  id: string;
  slug: string;
  title: string;
  path: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  fallbackImage: string | null;
  descriptionSources: Array<string | null | undefined>;
}): AuditFinding | null {
  const missing: string[] = [];
  const suggested: AuditFinding["suggested"] = {};

  const title = (args.seoTitle ?? "").trim();
  if (!title) {
    missing.push("seoTitle");
    suggested.seoTitle = clampTitle(args.title);
  } else if (title.length > MAX_TITLE) {
    missing.push("seoTitleLong");
    suggested.seoTitle = clampTitle(title);
  }

  const description = (args.seoDescription ?? "").trim();
  if (!description) {
    missing.push("seoDescription");
    const suggestion = suggestDescription(args.descriptionSources);
    if (suggestion) suggested.seoDescription = suggestion;
  } else if (description.length < MIN_DESCRIPTION) {
    missing.push("seoDescriptionShort");
  } else if (description.length > MAX_DESCRIPTION) {
    missing.push("seoDescriptionLong");
    suggested.seoDescription = clampDescription(description);
  }

  const image = (args.ogImage ?? "").trim();
  if (!image) {
    missing.push("ogImage");
    const fallback = (args.fallbackImage ?? "").trim();
    if (fallback) suggested.ogImage = fallback;
  }

  if (missing.length === 0) return null;

  return {
    kind: args.kind,
    id: args.id,
    slug: args.slug,
    title: args.title,
    path: args.path,
    missing,
    suggested,
  };
}

async function auditPosts(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: postsTable.id,
      slug: postsTable.slug,
      title: postsTable.title,
      subtitle: postsTable.subtitle,
      excerpt: postsTable.excerpt,
      bodyMarkdown: postsTable.bodyMarkdown,
      bodyHtml: postsTable.bodyHtml,
      seoTitle: postsTable.seoTitle,
      seoDescription: postsTable.seoDescription,
      heroImageUrl: mediaTable.publicUrl,
    })
    .from(postsTable)
    .leftJoin(mediaTable, eq(postsTable.heroImageId, mediaTable.id))
    .where(
      and(
        isNull(postsTable.deletedAt),
        eq(postsTable.status, "published"),
        lte(postsTable.publishedAt, new Date()),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "insight",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/insights/${r.slug}`,
      seoTitle: null, // posts: seoTitle not required — buildTitle handles it
      seoDescription: r.seoDescription,
      ogImage: null, // posts use heroImage via ogImageId path; treat as implicit ok
      fallbackImage: r.heroImageUrl ?? null,
      descriptionSources: [r.excerpt, r.subtitle, r.bodyMarkdown, r.bodyHtml],
    });
    if (f) {
      // Drop seoTitle check for posts — Meta component fills it from `title`.
      f.missing = f.missing.filter((m) => !m.startsWith("seoTitle"));
      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

async function auditServices(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: servicesTable.id,
      slug: servicesTable.slug,
      title: servicesTable.title,
      blurbHtml: servicesTable.blurbHtml,
      heroTextHtml: servicesTable.heroTextHtml,
      secondaryTextHtml: servicesTable.secondaryTextHtml,
      seoTitle: servicesTable.seoTitle,
      seoDescription: servicesTable.seoDescription,
    })
    .from(servicesTable)
    .where(
      and(
        isNull(servicesTable.deletedAt),
        eq(servicesTable.active, true),
        eq(servicesTable.status, "published"),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "service",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/services/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: null,
      fallbackImage: null,
      descriptionSources: [r.blurbHtml, r.heroTextHtml, r.secondaryTextHtml],
    });
    if (f) findings.push(f);
  }
  return { total: rows.length, findings };
}

async function auditSolutions(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: solutionsTable.id,
      slug: solutionsTable.slug,
      title: solutionsTable.title,
      blurbHtml: solutionsTable.blurbHtml,
      heroTextHtml: solutionsTable.heroTextHtml,
      seoTitle: solutionsTable.seoTitle,
      seoDescription: solutionsTable.seoDescription,
    })
    .from(solutionsTable)
    .where(
      and(
        isNull(solutionsTable.deletedAt),
        eq(solutionsTable.active, true),
        eq(solutionsTable.status, "published"),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "solution",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/solutions/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: null,
      fallbackImage: null,
      descriptionSources: [r.blurbHtml, r.heroTextHtml],
    });
    if (f) findings.push(f);
  }
  return { total: rows.length, findings };
}

async function auditApplications(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: applicationsTable.id,
      slug: applicationsTable.slug,
      title: applicationsTable.title,
      name: applicationsTable.name,
      tagline: applicationsTable.tagline,
      shortSummary: applicationsTable.shortSummary,
      descriptionParagraphs: applicationsTable.descriptionParagraphs,
      screenshot: applicationsTable.screenshot,
      logo: applicationsTable.logo,
      seoTitle: applicationsTable.seoTitle,
      seoDescription: applicationsTable.seoDescription,
      ogImage: applicationsTable.ogImage,
    })
    .from(applicationsTable)
    .where(
      and(
        isNull(applicationsTable.deletedAt),
        eq(applicationsTable.active, true),
        eq(applicationsTable.status, "published"),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const firstPara = Array.isArray(r.descriptionParagraphs)
      ? r.descriptionParagraphs[0] ?? ""
      : "";
    const f = buildFinding({
      kind: "application",
      id: r.id,
      slug: r.slug,
      title: r.name || r.title,
      path: `/applications/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: r.ogImage,
      fallbackImage: firstNonEmpty(r.screenshot, r.logo),
      descriptionSources: [r.tagline, r.shortSummary, firstPara],
    });
    if (f) findings.push(f);
  }
  return { total: rows.length, findings };
}

async function auditCaseStudies(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: caseStudiesTable.id,
      slug: caseStudiesTable.slug,
      title: caseStudiesTable.title,
      headline: caseStudiesTable.headline,
      summary: caseStudiesTable.summary,
      heroImage: caseStudiesTable.heroImage,
      seoTitle: caseStudiesTable.seoTitle,
      seoDescription: caseStudiesTable.seoDescription,
      ogImage: caseStudiesTable.ogImage,
    })
    .from(caseStudiesTable)
    .where(
      and(
        isNull(caseStudiesTable.deletedAt),
        eq(caseStudiesTable.active, true),
        eq(caseStudiesTable.status, "published"),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "case-study",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/case-studies/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: r.ogImage,
      fallbackImage: r.heroImage,
      descriptionSources: [r.headline, r.summary],
    });
    if (f) findings.push(f);
  }
  return { total: rows.length, findings };
}

async function auditModels(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  const rows = await db
    .select({
      id: modelsTable.id,
      slug: modelsTable.slug,
      title: modelsTable.title,
      shortDescription: modelsTable.shortDescription,
      longDescriptionHtml: modelsTable.longDescriptionHtml,
      heroImage: modelsTable.heroImage,
      seoTitle: modelsTable.seoTitle,
      seoDescription: modelsTable.seoDescription,
      ogImage: modelsTable.ogImage,
    })
    .from(modelsTable)
    .where(
      and(
        isNull(modelsTable.deletedAt),
        eq(modelsTable.active, true),
        eq(modelsTable.status, "published"),
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "model",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/models/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: r.ogImage,
      fallbackImage: r.heroImage,
      descriptionSources: [r.shortDescription, r.longDescriptionHtml],
    });
    if (f) findings.push(f);
  }
  return { total: rows.length, findings };
}

export async function runAudit(): Promise<AuditReport> {
  const [posts, services, solutions, applications, caseStudies, models] = await Promise.all([
    auditPosts(),
    auditServices(),
    auditSolutions(),
    auditApplications(),
    auditCaseStudies(),
    auditModels(),
  ]);

  const findings = [
    ...posts.findings,
    ...services.findings,
    ...solutions.findings,
    ...applications.findings,
    ...caseStudies.findings,
    ...models.findings,
  ];

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      insight: { total: posts.total, missing: posts.findings.length },
      service: { total: services.total, missing: services.findings.length },
      solution: { total: solutions.total, missing: solutions.findings.length },
      application: { total: applications.total, missing: applications.findings.length },
      "case-study": { total: caseStudies.total, missing: caseStudies.findings.length },
      model: { total: models.total, missing: models.findings.length },
    },
    findings,
  };
}

/**
 * Apply the suggested descriptions and OG images from an audit report.
 * Only fills columns that are currently empty — never overwrites editor
 * values. Returns the number of rows touched per artifact kind.
 */
export async function applyAutofill(
  findings: AuditFinding[],
): Promise<Record<ArtifactKind, number>> {
  const touched: Record<ArtifactKind, number> = {
    insight: 0,
    service: 0,
    solution: 0,
    application: 0,
    "case-study": 0,
    model: 0,
  };

  for (const f of findings) {
    const patch: {
      seoTitle?: string;
      seoDescription?: string;
      ogImage?: string;
    } = {};
    if (f.suggested.seoTitle && f.missing.includes("seoTitle")) {
      patch.seoTitle = f.suggested.seoTitle;
    }
    if (f.suggested.seoDescription && f.missing.includes("seoDescription")) {
      patch.seoDescription = f.suggested.seoDescription;
    }
    if (f.suggested.ogImage && f.missing.includes("ogImage")) {
      patch.ogImage = f.suggested.ogImage;
    }
    if (Object.keys(patch).length === 0) continue;

    switch (f.kind) {
      case "insight": {
        if (patch.seoDescription) {
          await db
            .update(postsTable)
            .set({
              seoDescription: patch.seoDescription,
              updatedAt: new Date(),
            })
            .where(
              and(eq(postsTable.id, f.id), isNull(postsTable.seoDescription)),
            );
          touched.insight += 1;
        }
        break;
      }
      case "service": {
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.seoTitle) set.seoTitle = patch.seoTitle;
        if (patch.seoDescription) set.seoDescription = patch.seoDescription;
        if (Object.keys(set).length > 1) {
          await db.update(servicesTable).set(set).where(eq(servicesTable.id, f.id));
          touched.service += 1;
        }
        break;
      }
      case "solution": {
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.seoTitle) set.seoTitle = patch.seoTitle;
        if (patch.seoDescription) set.seoDescription = patch.seoDescription;
        if (Object.keys(set).length > 1) {
          await db.update(solutionsTable).set(set).where(eq(solutionsTable.id, f.id));
          touched.solution += 1;
        }
        break;
      }
      case "application": {
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.seoTitle) set.seoTitle = patch.seoTitle;
        if (patch.seoDescription) set.seoDescription = patch.seoDescription;
        if (patch.ogImage) set.ogImage = patch.ogImage;
        if (Object.keys(set).length > 1) {
          await db.update(applicationsTable).set(set).where(eq(applicationsTable.id, f.id));
          touched.application += 1;
        }
        break;
      }
      case "case-study": {
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.seoTitle) set.seoTitle = patch.seoTitle;
        if (patch.seoDescription) set.seoDescription = patch.seoDescription;
        if (patch.ogImage) set.ogImage = patch.ogImage;
        if (Object.keys(set).length > 1) {
          await db.update(caseStudiesTable).set(set).where(eq(caseStudiesTable.id, f.id));
          touched["case-study"] += 1;
        }
        break;
      }
      case "model": {
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.seoTitle) set.seoTitle = patch.seoTitle;
        if (patch.seoDescription) set.seoDescription = patch.seoDescription;
        if (patch.ogImage) set.ogImage = patch.ogImage;
        if (Object.keys(set).length > 1) {
          await db.update(modelsTable).set(set).where(eq(modelsTable.id, f.id));
          touched.model += 1;
        }
        break;
      }
    }
  }

  // Use sql only if needed; drizzle imports kept minimal.
  void sql;
  return touched;
}
