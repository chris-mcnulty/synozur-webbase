import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  postsTable,
  servicesTable,
  solutionsTable,
  applicationsTable,
  caseStudiesTable,
  modelsTable,
  workshopsTable,
  polarisEpisodesTable,
  mediaTable,
  eventsTable,
  collateralTable,
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
  | "model"
  | "workshop"
  | "polaris"
  | "event"
  | "collateral";

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
export function buildFinding(args: {
  kind: ArtifactKind;
  id: string;
  slug: string;
  title: string;
  path: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  fallbackImage: string | null;
  /**
   * #357 — explicit "the editor set a share image" signal for tables whose
   * image lives behind an id (e.g. posts' ogImageId/heroImageId) rather than a
   * URL column. When true, suppresses the `og_image_missing` warning even if
   * `ogImage`/`fallbackImage` are both blank. When omitted, presence is derived
   * from `ogImage`/`fallbackImage`.
   */
  hasEditorImage?: boolean;
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
    // Suggest a better description from body content so the wizard can fix it
    const suggestion = suggestDescription(args.descriptionSources);
    if (suggestion && suggestion.length >= MIN_DESCRIPTION) suggested.seoDescription = suggestion;
    else if (suggestion) suggested.seoDescription = suggestion; // even if short, it may be all available content
  } else if (description.length > MAX_DESCRIPTION) {
    missing.push("seoDescriptionLong");
    suggested.seoDescription = clampDescription(description);
  }

  // #357 — Two distinct OG-image signals:
  //   * "ogImage" — the dedicated og_image column is blank but a hero/artwork
  //     image exists that we can promote into it (autofillable). Only pushed
  //     for tables that actually have an og_image column; callers for tables
  //     without one strip it (see the `startsWith("ogImage")` filters).
  //   * "og_image_missing" — the page has NO editor-set share image at all, so
  //     social unfurls fall back to the dynamic /api/og/image card. That card
  //     is valid + branded but typically gets less engagement than a real
  //     photo, so marketing wants a heads-up. Pure warning; not autofillable.
  const image = (args.ogImage ?? "").trim();
  const fallback = (args.fallbackImage ?? "").trim();
  const hasEditorImage =
    image !== "" || fallback !== "" || args.hasEditorImage === true;
  if (!image && fallback) {
    missing.push("ogImage");
    suggested.ogImage = fallback;
  }
  if (!hasEditorImage) {
    missing.push("og_image_missing");
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

/**
 * #360 — Centralized, per-kind suppression of OG-image findings so the branching
 * can't silently regress as new audited kinds are added. Two independent switches:
 *
 *  - `suppressOgImageAutofill` — drop the autofillable "ogImage" promote finding.
 *    Set for kinds with NO writable `og_image` URL column (posts, services,
 *    solutions, workshops): there's nowhere for `applyAutofill` to persist it.
 *  - `suppressOgImageMissing` — drop the "og_image_missing" warning. Set for kinds
 *    with NO editor share-image field of ANY kind (services, solutions): the
 *    warning would be permanent + unfixable = pure noise. Kinds that DO have a
 *    fixable share image (insights via hero/og ids, workshops via heroImage,
 *    polaris via artwork/og) keep the warning so it stays actionable.
 *
 * Because this is a total `Record<ArtifactKind, …>`, adding a new `ArtifactKind`
 * without a policy entry is a compile error — the whole point of the task.
 */
export const OG_FINDING_POLICY: Record<
  ArtifactKind,
  { suppressOgImageAutofill: boolean; suppressOgImageMissing: boolean }
> = {
  insight: { suppressOgImageAutofill: true, suppressOgImageMissing: false },
  service: { suppressOgImageAutofill: true, suppressOgImageMissing: true },
  solution: { suppressOgImageAutofill: true, suppressOgImageMissing: true },
  application: { suppressOgImageAutofill: false, suppressOgImageMissing: false },
  "case-study": { suppressOgImageAutofill: false, suppressOgImageMissing: false },
  model: { suppressOgImageAutofill: false, suppressOgImageMissing: false },
  workshop: { suppressOgImageAutofill: true, suppressOgImageMissing: false },
  polaris: { suppressOgImageAutofill: false, suppressOgImageMissing: false },
  // Events have hero images (imageAssetId / imageMediaId) but no og_image URL
  // column, so autofill can't persist a URL. Keep og_image_missing so editors
  // know an image would improve unfurls.
  event: { suppressOgImageAutofill: true, suppressOgImageMissing: false },
  // Collateral has a heroImage text field but no og_image column. Same logic.
  collateral: { suppressOgImageAutofill: true, suppressOgImageMissing: false },
};

/**
 * Apply the OG-image suppression policy for a kind to a finding's `missing` list.
 * Note: the autofill key is camelCase `ogImage` while the warning is snake_case
 * `og_image_missing`, so `startsWith("ogImage")` matches only the autofill key.
 */
export function filterOgFindings(kind: ArtifactKind, missing: string[]): string[] {
  const policy = OG_FINDING_POLICY[kind];
  return missing.filter((m) => {
    if (policy.suppressOgImageAutofill && m.startsWith("ogImage")) return false;
    if (policy.suppressOgImageMissing && m === "og_image_missing") return false;
    return true;
  });
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
      ogImageId: postsTable.ogImageId,
      heroImageId: postsTable.heroImageId,
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
    // Pass seoTitle ?? title so that seoTitleLong fires when either the explicit
    // SEO title or the post title itself is too long. We still suppress the
    // "seoTitle missing" finding (posts don't require it — Meta falls back to title).
    const f = buildFinding({
      kind: "insight",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/insights/${r.slug}`,
      seoTitle: r.seoTitle ?? r.title,
      seoDescription: r.seoDescription,
      ogImage: null, // posts have no og_image URL column — image lives behind ids
      fallbackImage: null,
      // #357 — a post has a real share image when either the dedicated OG image
      // or the hero image id is set (mirrors ogResolver's `ogImageId ?? heroImageId`).
      // When neither is set, social unfurls fall back to the dynamic OG card.
      hasEditorImage: Boolean(r.ogImageId || r.heroImageId),
      descriptionSources: [r.excerpt, r.subtitle, r.bodyMarkdown, r.bodyHtml],
    });
    if (f) {
      // Drop only the "seoTitle missing" check — Meta component fills it from
      // `title`. Keep "seoTitleLong" so posts with overlong titles are flagged.
      // OG handling (drop autofill "ogImage", keep og_image_missing) is
      // centralized in OG_FINDING_POLICY.
      f.missing = filterOgFindings(
        "insight",
        f.missing.filter((m) => m !== "seoTitle"),
      );
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
        sql`(${servicesTable.publishedAt} is null or ${servicesTable.publishedAt} <= now())`,
        sql`(${servicesTable.unpublishedAt} is null or ${servicesTable.unpublishedAt} > now())`,
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
    if (f) {
      // Services have no image column of any kind (no og_image, no hero), so
      // they ALWAYS render the dynamic OG card. OG_FINDING_POLICY drops both the
      // autofill "ogImage" check and the "og_image_missing" warning — there's no
      // field to fix, so surfacing either would be permanent noise.
      f.missing = filterOgFindings("service", f.missing);
      if (f.missing.length) findings.push(f);
    }
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
        sql`(${solutionsTable.publishedAt} is null or ${solutionsTable.publishedAt} <= now())`,
        sql`(${solutionsTable.unpublishedAt} is null or ${solutionsTable.unpublishedAt} > now())`,
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
    if (f) {
      // Solutions have no image column of any kind (see auditServices note):
      // OG_FINDING_POLICY drops both the autofill "ogImage" check and the
      // "og_image_missing" warning — nothing to fix, so it would only be noise.
      f.missing = filterOgFindings("solution", f.missing);
      if (f.missing.length) findings.push(f);
    }
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
        sql`(${applicationsTable.publishedAt} is null or ${applicationsTable.publishedAt} <= now())`,
        sql`(${applicationsTable.unpublishedAt} is null or ${applicationsTable.unpublishedAt} > now())`,
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
    if (f) {
      f.missing = filterOgFindings("application", f.missing);
      if (f.missing.length) findings.push(f);
    }
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
        sql`(${caseStudiesTable.publishedAt} is null or ${caseStudiesTable.publishedAt} <= now())`,
        sql`(${caseStudiesTable.unpublishedAt} is null or ${caseStudiesTable.unpublishedAt} > now())`,
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
    if (f) {
      f.missing = filterOgFindings("case-study", f.missing);
      if (f.missing.length) findings.push(f);
    }
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
        sql`(${modelsTable.publishedAt} is null or ${modelsTable.publishedAt} <= now())`,
        sql`(${modelsTable.unpublishedAt} is null or ${modelsTable.unpublishedAt} > now())`,
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
    if (f) {
      f.missing = filterOgFindings("model", f.missing);
      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

async function auditWorkshops(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  // Workshops store SEO copy in a `seo` JSONB ({ title, description }) and
  // have no top-level ogImage — heroImage is the fallback. Lifecycle is just
  // active+deletedAt today (no status/publishedAt parity yet — see backlog).
  const rows = await db
    .select({
      id: workshopsTable.id,
      slug: workshopsTable.slug,
      title: workshopsTable.title,
      shortDescription: workshopsTable.shortDescription,
      heroSubhead: workshopsTable.heroSubhead,
      heroImage: workshopsTable.heroImage,
      seo: workshopsTable.seo,
    })
    .from(workshopsTable)
    .where(and(isNull(workshopsTable.deletedAt), eq(workshopsTable.active, true)));

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "workshop",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/workshops/${r.slug}`,
      seoTitle: r.seo?.title ?? null,
      seoDescription: r.seo?.description ?? null,
      ogImage: null,
      // Workshops have no og_image column, but heroImage IS an editor-settable
      // share image. Pass it as the fallback so the og_image_missing warning
      // only fires when the hero is also blank (an actionable finding).
      fallbackImage: r.heroImage,
      descriptionSources: [r.shortDescription, r.heroSubhead],
    });
    if (f) {
      // Workshops have no ogImage column; heroImage serves as the implicit OG
      // image (same as posts). OG_FINDING_POLICY drops the autofill "ogImage"
      // check (applyAutofill can't persist it) but keeps the og_image_missing
      // warning (it points at the fixable hero image field).
      f.missing = filterOgFindings("workshop", f.missing);
      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

async function auditPolaris(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  // Polaris podcast episodes (#101). Built on the shared artifact pattern —
  // flat seoTitle/seoDescription/ogImage columns (artifactSeo) plus an
  // episode-specific `artworkUrl` that doubles as the share image. When both
  // ogImage and artworkUrl are blank the /polaris/:slug page falls back to the
  // dynamic OG card, which is what og_image_missing flags. Podcast episodes are
  // published frequently and heavily shared, so this warning matters here.
  const rows = await db
    .select({
      id: polarisEpisodesTable.id,
      slug: polarisEpisodesTable.slug,
      title: polarisEpisodesTable.title,
      summary: polarisEpisodesTable.summary,
      seoTitle: polarisEpisodesTable.seoTitle,
      seoDescription: polarisEpisodesTable.seoDescription,
      ogImage: polarisEpisodesTable.ogImage,
      artworkUrl: polarisEpisodesTable.artworkUrl,
    })
    .from(polarisEpisodesTable)
    .where(
      and(
        isNull(polarisEpisodesTable.deletedAt),
        eq(polarisEpisodesTable.active, true),
        eq(polarisEpisodesTable.status, "published"),
        sql`(${polarisEpisodesTable.publishedAt} is null or ${polarisEpisodesTable.publishedAt} <= now())`,
        sql`(${polarisEpisodesTable.unpublishedAt} is null or ${polarisEpisodesTable.unpublishedAt} > now())`,
      ),
    );

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "polaris",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path: `/polaris/${r.slug}`,
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      ogImage: r.ogImage,
      fallbackImage: r.artworkUrl,
      descriptionSources: [r.summary],
    });
    if (f) {
      f.missing = filterOgFindings("polaris", f.missing);
      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

async function auditEvents(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  // Events use a free-form text `status` field. We audit all non-archived
  // events since even UPCOMING events get indexed before they go live.
  const rows = await db
    .select({
      id: eventsTable.id,
      slug: eventsTable.slug,
      title: eventsTable.title,
      teaser: eventsTable.teaser,
      description: eventsTable.description,
      imageAssetId: eventsTable.imageAssetId,
      imageMediaId: eventsTable.imageMediaId,
      seoTitle: eventsTable.seoTitle,
      seoDescription: eventsTable.seoDescription,
    })
    .from(eventsTable)
    .where(sql`lower(${eventsTable.status}) != 'archived'`);

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const f = buildFinding({
      kind: "event",
      id: String(r.id),
      slug: r.slug,
      title: r.title,
      path: `/events/${r.slug}`,
      seoTitle: r.seoTitle ?? null,
      seoDescription: r.seoDescription ?? null,
      ogImage: null,
      fallbackImage: null,
      // Events show a hero image when either imageAssetId or imageMediaId is
      // set — use those as the "has editor image" signal (mirrors resolveEventImageUrl).
      hasEditorImage: Boolean(r.imageAssetId || r.imageMediaId),
      descriptionSources: [r.teaser, r.description],
    });
    if (f) {
      f.missing = filterOgFindings("event", f.missing);
      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

async function auditCollateral(): Promise<{
  total: number;
  findings: AuditFinding[];
}> {
  // Audit active, non-deleted collateral. Webinars live at /webinars/:slug;
  // everything else (guides, toolkits, reports, …) lives at /library/:slug.
  const rows = await db
    .select({
      id: collateralTable.id,
      slug: collateralTable.slug,
      type: collateralTable.type,
      title: collateralTable.title,
      subtitle: collateralTable.subtitle,
      description: collateralTable.description,
      heroImage: collateralTable.heroImage,
      seoTitle: collateralTable.seoTitle,
      seoDescription: collateralTable.seoDescription,
    })
    .from(collateralTable)
    .where(and(isNull(collateralTable.deletedAt), eq(collateralTable.active, true)));

  const findings: AuditFinding[] = [];
  for (const r of rows) {
    const path = r.type === "webinar" ? `/webinars/${r.slug}` : `/library/${r.slug}`;
    const f = buildFinding({
      kind: "collateral",
      id: r.id,
      slug: r.slug,
      title: r.title,
      path,
      seoTitle: r.seoTitle ?? null,
      seoDescription: r.seoDescription ?? null,
      ogImage: null,
      fallbackImage: r.heroImage || null,
      descriptionSources: [r.subtitle, r.description],
    });
    if (f) {
      f.missing = filterOgFindings("collateral", f.missing);

      // #377 — For collateral, any non-empty seoTitle / seoDescription (whether
      // autofilled or manually set by an editor) satisfies the check. Suppress
      // length-quality variants so that an intentionally short or long
      // editor-entered value doesn't keep the item in the findings list.
      // The empty-field findings ("seoTitle" / "seoDescription") still fire
      // normally for blank values; only the length variants are suppressed here.
      if ((r.seoTitle ?? "").trim()) {
        f.missing = f.missing.filter((m) => m !== "seoTitleLong");
      }
      if ((r.seoDescription ?? "").trim()) {
        f.missing = f.missing.filter(
          (m) => m !== "seoDescriptionShort" && m !== "seoDescriptionLong",
        );
      }

      if (f.missing.length) findings.push(f);
    }
  }
  return { total: rows.length, findings };
}

export async function runAudit(): Promise<AuditReport> {
  const [posts, services, solutions, applications, caseStudies, models, workshops, polaris, events, collateral] =
    await Promise.all([
      auditPosts(),
      auditServices(),
      auditSolutions(),
      auditApplications(),
      auditCaseStudies(),
      auditModels(),
      auditWorkshops(),
      auditPolaris(),
      auditEvents(),
      auditCollateral(),
    ]);

  const findings = [
    ...posts.findings,
    ...services.findings,
    ...solutions.findings,
    ...applications.findings,
    ...caseStudies.findings,
    ...models.findings,
    ...workshops.findings,
    ...polaris.findings,
    ...events.findings,
    ...collateral.findings,
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
      workshop: { total: workshops.total, missing: workshops.findings.length },
      polaris: { total: polaris.total, missing: polaris.findings.length },
      event: { total: events.total, missing: events.findings.length },
      collateral: { total: collateral.total, missing: collateral.findings.length },
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
    workshop: 0,
    polaris: 0,
    event: 0,
    collateral: 0,
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
    const descIssue = f.missing.some((m) =>
      ["seoDescription", "seoDescriptionShort", "seoDescriptionLong"].includes(m),
    );
    if (f.suggested.seoDescription && descIssue) {
      patch.seoDescription = f.suggested.seoDescription;
    }
    if (f.suggested.ogImage && f.missing.includes("ogImage")) {
      patch.ogImage = f.suggested.ogImage;
    }
    if (Object.keys(patch).length === 0) continue;

    switch (f.kind) {
      case "insight": {
        if (patch.seoDescription) {
          // For length issues (too short / too long), overwrite the existing
          // value with the better suggestion. For a fully-empty description,
          // guard against a concurrent editor write using the SQL empty check.
          const isLengthIssue = f.missing.some((m) =>
            ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
          );
          const whereClause = isLengthIssue
            ? eq(postsTable.id, f.id)
            : and(
                eq(postsTable.id, f.id),
                sql`(${postsTable.seoDescription} is null or trim(${postsTable.seoDescription}) = '')`,
              );
          const updatedInsights = await db
            .update(postsTable)
            .set({ seoDescription: patch.seoDescription, updatedAt: new Date() })
            .where(whereClause)
            .returning({ id: postsTable.id });
          if (updatedInsights.length > 0) touched.insight += 1;
        }
        break;
      }
      case "service": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(servicesTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${servicesTable.seoTitle} is null or trim(${servicesTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${servicesTable.seoDescription} is null or trim(${servicesTable.seoDescription}) = '')`,
            );
          }
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(servicesTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: servicesTable.id });
          if (rows.length > 0) touched.service += 1;
        }
        break;
      }
      case "solution": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(solutionsTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${solutionsTable.seoTitle} is null or trim(${solutionsTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${solutionsTable.seoDescription} is null or trim(${solutionsTable.seoDescription}) = '')`,
            );
          }
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(solutionsTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: solutionsTable.id });
          if (rows.length > 0) touched.solution += 1;
        }
        break;
      }
      case "application": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(applicationsTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${applicationsTable.seoTitle} is null or trim(${applicationsTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${applicationsTable.seoDescription} is null or trim(${applicationsTable.seoDescription}) = '')`,
            );
          }
        }
        if (patch.ogImage) {
          set.ogImage = patch.ogImage;
          guards.push(
            sql`(${applicationsTable.ogImage} is null or trim(${applicationsTable.ogImage}) = '')`,
          );
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(applicationsTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: applicationsTable.id });
          if (rows.length > 0) touched.application += 1;
        }
        break;
      }
      case "case-study": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(caseStudiesTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${caseStudiesTable.seoTitle} is null or trim(${caseStudiesTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${caseStudiesTable.seoDescription} is null or trim(${caseStudiesTable.seoDescription}) = '')`,
            );
          }
        }
        if (patch.ogImage) {
          set.ogImage = patch.ogImage;
          guards.push(
            sql`(${caseStudiesTable.ogImage} is null or trim(${caseStudiesTable.ogImage}) = '')`,
          );
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(caseStudiesTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: caseStudiesTable.id });
          if (rows.length > 0) touched["case-study"] += 1;
        }
        break;
      }
      case "polaris": {
        // Flat seoTitle/seoDescription/ogImage columns (same shape as models).
        // og_image_missing is never a patch key (not in `suggested`), so this
        // only ever fills seoTitle/seoDescription/ogImage when a fallback exists.
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(polarisEpisodesTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${polarisEpisodesTable.seoTitle} is null or trim(${polarisEpisodesTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${polarisEpisodesTable.seoDescription} is null or trim(${polarisEpisodesTable.seoDescription}) = '')`,
            );
          }
        }
        if (patch.ogImage) {
          set.ogImage = patch.ogImage;
          guards.push(
            sql`(${polarisEpisodesTable.ogImage} is null or trim(${polarisEpisodesTable.ogImage}) = '')`,
          );
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(polarisEpisodesTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: polarisEpisodesTable.id });
          if (rows.length > 0) touched.polaris += 1;
        }
        break;
      }
      case "model": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(modelsTable.id, f.id)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${modelsTable.seoTitle} is null or trim(${modelsTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${modelsTable.seoDescription} is null or trim(${modelsTable.seoDescription}) = '')`,
            );
          }
        }
        if (patch.ogImage) {
          set.ogImage = patch.ogImage;
          guards.push(
            sql`(${modelsTable.ogImage} is null or trim(${modelsTable.ogImage}) = '')`,
          );
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(modelsTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: modelsTable.id });
          if (rows.length > 0) touched.model += 1;
        }
        break;
      }
      case "workshop": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        // Workshops keep SEO copy in a JSONB column, so we read-modify-write
        // the `seo` object instead of patching flat columns.
        if (!patch.seoTitle && !patch.seoDescription) break;
        const existing = await db.query.workshopsTable.findFirst({
          where: and(eq(workshopsTable.id, f.id), isNull(workshopsTable.deletedAt)),
          columns: { seo: true },
        });
        if (!existing) break;
        const seo = existing.seo ?? { title: "", description: "" };
        const next = { ...seo };
        const guards = [eq(workshopsTable.id, f.id), isNull(workshopsTable.deletedAt)];
        let changed = false;
        if (patch.seoTitle && !(seo.title ?? "").trim()) {
          next.title = patch.seoTitle;
          guards.push(
            sql`(((${workshopsTable.seo} ->> 'title') is null) or trim(${workshopsTable.seo} ->> 'title') = '')`,
          );
          changed = true;
        }
        if (patch.seoDescription) {
          const descEmpty = !(seo.description ?? "").trim();
          if (descEmpty || isLengthIssue) {
            next.description = patch.seoDescription;
            if (!isLengthIssue) {
              guards.push(
                sql`(((${workshopsTable.seo} ->> 'description') is null) or trim(${workshopsTable.seo} ->> 'description') = '')`,
              );
            }
            changed = true;
          }
        }
        if (changed) {
          const rows = await db
            .update(workshopsTable)
            .set({ seo: next, updatedAt: new Date() })
            .where(and(...guards))
            .returning({ id: workshopsTable.id });
          if (rows.length > 0) touched.workshop += 1;
        }
        break;
      }
      case "event": {
        // Events use integer PKs — convert f.id back to a number.
        const eventId = Number.parseInt(f.id, 10);
        if (!Number.isFinite(eventId)) break;
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(eventsTable.id, eventId)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${eventsTable.seoTitle} is null or trim(${eventsTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${eventsTable.seoDescription} is null or trim(${eventsTable.seoDescription}) = '')`,
            );
          }
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(eventsTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: eventsTable.id });
          if (rows.length > 0) touched.event += 1;
        }
        break;
      }
      case "collateral": {
        const isLengthIssue = f.missing.some((m) =>
          ["seoDescriptionShort", "seoDescriptionLong"].includes(m),
        );
        const set: Record<string, unknown> = { updatedAt: new Date() };
        const guards = [eq(collateralTable.id, f.id), isNull(collateralTable.deletedAt)];
        if (patch.seoTitle) {
          set.seoTitle = patch.seoTitle;
          guards.push(
            sql`(${collateralTable.seoTitle} is null or trim(${collateralTable.seoTitle}) = '')`,
          );
        }
        if (patch.seoDescription) {
          set.seoDescription = patch.seoDescription;
          if (!isLengthIssue) {
            guards.push(
              sql`(${collateralTable.seoDescription} is null or trim(${collateralTable.seoDescription}) = '')`,
            );
          }
        }
        if (Object.keys(set).length > 1) {
          const rows = await db
            .update(collateralTable)
            .set(set)
            .where(and(...guards))
            .returning({ id: collateralTable.id });
          if (rows.length > 0) touched.collateral += 1;
        }
        break;
      }
    }
  }

  return touched;
}
