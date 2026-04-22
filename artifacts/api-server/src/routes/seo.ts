import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
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
} from "@workspace/db";

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
  for (const _m of team) {
    // Team member detail pages don't currently exist; the /team grid suffices.
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

async function handleSitemap(_req: import("express").Request, res: import("express").Response) {
  const entries = await collectEntries();
  const xml = renderSitemap(entries);
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

export default router;
export { handleSitemap, handleRobots };
