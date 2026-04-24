import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  postsTable,
  collateralTable,
  servicesTable,
  solutionsTable,
  teamMembersTable,
  eventsTable,
  applicationsTable,
  caseStudiesTable,
  modelsTable,
  siteSettingsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { runAudit, applyAutofill } from "../lib/seoAudit";
import { submitUrls } from "../lib/seoSubmit";

const router: IRouter = Router();

const DEFAULT_SITE_URL = "https://www.synozur.com";

function siteOrigin(): string {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Entry {
  loc: string;
  lastmod?: string | null;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

/**
 * Static marketing routes that don't live in the database. Applications
 * (#103) and case studies (#102) now live in their own DB tables, so the
 * sitemap pulls them via Drizzle below — no more duplicated slug lists.
 * Workshop slugs still come from the static data file (#95).
 */
const STATIC_ROUTES: Entry[] = [
  { loc: "/", changefreq: "weekly", priority: 1.0 },
  { loc: "/about", changefreq: "monthly", priority: 0.7 },
  { loc: "/services-overview/default", changefreq: "weekly", priority: 0.9 },
  { loc: "/clients", changefreq: "monthly", priority: 0.7 },
  { loc: "/partners", changefreq: "monthly", priority: 0.6 },
  { loc: "/team", changefreq: "monthly", priority: 0.6 },
  { loc: "/case-studies", changefreq: "weekly", priority: 0.7 },
  { loc: "/applications", changefreq: "weekly", priority: 0.8 },
  { loc: "/models", changefreq: "weekly", priority: 0.8 },
  { loc: "/workshops", changefreq: "weekly", priority: 0.7 },
  { loc: "/library", changefreq: "weekly", priority: 0.7 },
  { loc: "/webinars", changefreq: "weekly", priority: 0.7 },
  { loc: "/items", changefreq: "weekly", priority: 0.6 },
  { loc: "/insights", changefreq: "daily", priority: 0.8 },
  { loc: "/events", changefreq: "weekly", priority: 0.6 },
  { loc: "/polaris", changefreq: "monthly", priority: 0.5 },
  { loc: "/contact", changefreq: "monthly", priority: 0.6 },
  { loc: "/start", changefreq: "monthly", priority: 0.6 },
  { loc: "/faq", changefreq: "weekly", priority: 0.7 },
  { loc: "/privacy", changefreq: "yearly", priority: 0.3 },
  { loc: "/terms", changefreq: "yearly", priority: 0.3 },
];

// Slugs sourced from artifacts/synozur/src/data/workshops.ts
const WORKSHOP_SLUGS = [
  "ai-academy-immersive-ai-leadership-day",
  "m365-academy-microsoft-365-transformation-day",
  "company-operating-system-bootcamp-two-day",
  "go-to-market-proxy-pitch-assessment",
];

function toEntry(path: string, lastmod: Date | string | null | undefined): Entry {
  let iso: string | null = null;
  if (lastmod) {
    const d = lastmod instanceof Date ? lastmod : new Date(lastmod);
    if (!Number.isNaN(d.getTime())) iso = d.toISOString();
  }
  return { loc: path, lastmod: iso };
}

async function collectEntries(): Promise<Entry[]> {
  const origin = siteOrigin();
  const entries: Entry[] = [];

  for (const r of STATIC_ROUTES) entries.push(r);
  for (const slug of WORKSHOP_SLUGS) entries.push({ loc: `/workshops/${slug}` });

  const [
    posts,
    collateral,
    services,
    solutions,
    team,
    events,
    applications,
    caseStudies,
    models,
  ] = await Promise.all([
    db
      .select({ slug: postsTable.slug, updatedAt: postsTable.updatedAt, publishedAt: postsTable.publishedAt })
      .from(postsTable)
      .where(
        and(
          isNull(postsTable.deletedAt),
          eq(postsTable.status, "published"),
          lte(postsTable.publishedAt, new Date()),
        ),
      )
      .orderBy(desc(postsTable.publishedAt)),
    db
      .select({
        slug: collateralTable.slug,
        type: collateralTable.type,
        updatedAt: collateralTable.updatedAt,
      })
      .from(collateralTable)
      .where(and(isNull(collateralTable.deletedAt), eq(collateralTable.active, true))),
    db
      .select({ slug: servicesTable.slug, updatedAt: servicesTable.updatedAt })
      .from(servicesTable)
      .where(
        and(
          isNull(servicesTable.deletedAt),
          eq(servicesTable.active, true),
          eq(servicesTable.status, "published"),
          sql`(${servicesTable.publishedAt} is null or ${servicesTable.publishedAt} <= now())`,
          sql`(${servicesTable.unpublishedAt} is null or ${servicesTable.unpublishedAt} > now())`,
        ),
      )
      .orderBy(asc(servicesTable.displayOrder)),
    db
      .select({ slug: solutionsTable.slug, updatedAt: solutionsTable.updatedAt })
      .from(solutionsTable)
      .where(
        and(
          isNull(solutionsTable.deletedAt),
          eq(solutionsTable.active, true),
          eq(solutionsTable.status, "published"),
          sql`(${solutionsTable.publishedAt} is null or ${solutionsTable.publishedAt} <= now())`,
          sql`(${solutionsTable.unpublishedAt} is null or ${solutionsTable.unpublishedAt} > now())`,
        ),
      )
      .orderBy(asc(solutionsTable.displayOrder)),
    db
      .select({ slug: teamMembersTable.slug, updatedAt: teamMembersTable.updatedAt })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.active, true)),
    db
      .select({ slug: eventsTable.slug, updatedAt: eventsTable.updatedAt })
      .from(eventsTable),
    db
      .select({
        slug: applicationsTable.slug,
        updatedAt: applicationsTable.updatedAt,
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
      ),
    db
      .select({
        slug: caseStudiesTable.slug,
        updatedAt: caseStudiesTable.updatedAt,
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
      ),
    db
      .select({
        slug: modelsTable.slug,
        updatedAt: modelsTable.updatedAt,
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
      ),
  ]);

  for (const p of posts) {
    entries.push(toEntry(`/insights/${p.slug}`, p.updatedAt ?? p.publishedAt));
  }
  for (const c of collateral) {
    // Library items all appear under /library/:slug; webinars also under /webinars/:slug;
    // catalog "items" under /items/:slug. Include the primary public route per type.
    switch (c.type) {
      case "webinar":
        entries.push(toEntry(`/webinars/${c.slug}`, c.updatedAt));
        entries.push(toEntry(`/library/${c.slug}`, c.updatedAt));
        break;
      case "event":
      case "case_study":
      case "insight":
        // These content types aren't linked from /library public pages by
        // default; skip to avoid 404s in the sitemap.
        break;
      default:
        entries.push(toEntry(`/library/${c.slug}`, c.updatedAt));
        break;
    }
  }
  for (const s of services) entries.push(toEntry(`/services/${s.slug}`, s.updatedAt));
  for (const s of solutions) entries.push(toEntry(`/solutions/${s.slug}`, s.updatedAt));
  for (const m of team) {
    entries.push(toEntry(`/team/${m.slug}`, m.updatedAt));
  }
  for (const _e of events) {
    // Events are listed on /events; no detail route is published yet.
  }
  for (const a of applications)
    entries.push(toEntry(`/applications/${a.slug}`, a.updatedAt));
  for (const c of caseStudies)
    entries.push(toEntry(`/case-studies/${c.slug}`, c.updatedAt));
  for (const m of models) entries.push(toEntry(`/models/${m.slug}`, m.updatedAt));

  // De-duplicate and absolutize.
  const seen = new Set<string>();
  const unique: Entry[] = [];
  for (const e of entries) {
    const key = e.loc;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...e, loc: `${origin}${e.loc}` });
  }
  return unique;
}

function renderSitemap(entries: Entry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : "";
      const changefreq = e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : "";
      const priority = typeof e.priority === "number" ? `<priority>${e.priority.toFixed(1)}</priority>` : "";
      return `<url><loc>${xmlEscape(e.loc)}</loc>${lastmod}${changefreq}${priority}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const SETTINGS_ID = 1;

async function loadSitemapSettings(): Promise<{
  excludedPaths: string[];
  sectionFlags: Record<string, boolean>;
}> {
  const [row] = await db
    .select({
      sitemapExcludedPaths: siteSettingsTable.sitemapExcludedPaths,
      sitemapSectionFlags: siteSettingsTable.sitemapSectionFlags,
    })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SETTINGS_ID));
  return {
    excludedPaths: row?.sitemapExcludedPaths ?? [],
    sectionFlags: row?.sitemapSectionFlags ?? {},
  };
}

async function handleSitemap(_req: import("express").Request, res: import("express").Response) {
  const [entries, { excludedPaths, sectionFlags }] = await Promise.all([
    collectEntries(),
    loadSitemapSettings(),
  ]);

  const origin = siteOrigin();

  // Section key → path prefix(es). Maps section flag names to URL segment(s).
  // Stored without trailing slash; matching checks both the exact path and sub-paths.
  const sectionPrefixes: Record<string, string[]> = {
    insights: ["/insights"],
    services: ["/services"],
    solutions: ["/solutions"],
    library: ["/library"],
    webinars: ["/webinars"],
    events: ["/events"],
    applications: ["/applications"],
    caseStudies: ["/case-studies"],
    models: ["/models"],
    workshops: ["/workshops"],
  };

  // Build a set of path prefixes to exclude from disabled sections.
  const disabledPrefixes = new Set<string>();
  for (const [key, enabled] of Object.entries(sectionFlags)) {
    if (enabled === false && sectionPrefixes[key]) {
      for (const prefix of sectionPrefixes[key]) {
        disabledPrefixes.add(prefix);
      }
    }
  }

  // Build a set of exact paths to exclude.
  const excludedSet = new Set(excludedPaths.map((p) => p.trim()).filter(Boolean));

  const filtered = entries.filter((e) => {
    // collectEntries() returns absolute URLs (origin + path). Strip the origin
    // prefix to get the path for comparison with excluded paths and section prefixes.
    const path = e.loc.startsWith(origin) ? e.loc.slice(origin.length) : e.loc;
    if (excludedSet.has(path)) return false;
    // Match the exact hub/listing page (e.g. /insights) AND any sub-paths
    // (e.g. /insights/my-post) so disabling a section removes all its URLs.
    for (const prefix of disabledPrefixes) {
      if (path === prefix || path.startsWith(prefix + "/")) return false;
    }
    return true;
  });

  const xml = renderSitemap(filtered);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(xml);
}

function renderRobots(): string {
  const origin = siteOrigin();
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /sign-in",
    "Disallow: /sign-up",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

function handleRobots(_req: import("express").Request, res: import("express").Response) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(renderRobots());
}

router.get("/sitemap.xml", handleSitemap);
router.get("/robots.txt", handleRobots);

// ─── SEO audit & submission — admin/editor only ───────────────────────────

const adminGuard = [requireAuth, requireRole("admin", "editor")];

/** Zod schema for the autofill endpoint — accepts an optional ID list. */
const AutofillBodySchema = z.object({
  /** Restrict autofill to specific artifacts by {kind, id}. Omit to apply to all findings. */
  ids: z
    .array(
      z.object({
        kind: z.enum([
          "insight",
          "service",
          "solution",
          "application",
          "case-study",
          "model",
        ]),
        id: z.string().uuid(),
      }),
    )
    .optional(),
});

/** Zod schema for the submit endpoint. */
const SubmitBodySchema = z.object({
  urls: z.array(z.string().url()).max(200),
});

/**
 * GET /api/seo/audit
 * Scans every published artifact for missing / out-of-bounds SEO metadata and
 * returns a structured report with per-type totals and individual findings.
 */
router.get("/seo/audit", adminGuard, async (_req, res): Promise<void> => {
  try {
    const report = await runAudit();
    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/seo/audit/autofill
 * Body: { ids?: Array<{kind, id}> }
 * Runs a fresh server-side audit and applies suggestions only to empty SEO
 * fields. Pass `ids` to restrict the operation to specific artifacts. Never
 * overwrites editor values.  Returns the number of rows touched per kind.
 */
router.post("/seo/audit/autofill", adminGuard, async (req, res): Promise<void> => {
  const parsed = AutofillBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    // Always recompute findings server-side to avoid trusting client data.
    const report = await runAudit();
    let findings = report.findings;
    if (parsed.data.ids && parsed.data.ids.length > 0) {
      const idSet = new Set(parsed.data.ids.map((i) => `${i.kind}:${i.id}`));
      findings = findings.filter((f) => idSet.has(`${f.kind}:${f.id}`));
    }
    const touched = await applyAutofill(findings);
    res.json({ touched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/seo/submit
 * Body: { urls: string[] }  (max 200 absolute URLs)
 * Submits the provided absolute URLs to every configured search-engine
 * channel (IndexNow, Google Indexing API, Bing Webmaster Tools).
 * Channels without credentials report ok:false but never throw.
 */
router.post("/seo/submit", adminGuard, async (req, res): Promise<void> => {
  const parsed = SubmitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const origin = siteOrigin();
    const bundle = await submitUrls(origin, parsed.data.urls);
    res.json(bundle);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
export { handleSitemap, handleRobots };
