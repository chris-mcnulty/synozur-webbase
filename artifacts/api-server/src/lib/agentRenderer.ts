/**
 * Agent / crawler prerenderer.
 *
 * Search crawlers and AI agents that issue plain HTTP fetches (and do not
 * execute JavaScript) would otherwise receive the bare SPA shell from the
 * synozur artifact. This module produces a content-rich, server-rendered HTML
 * document for any public path: a real <h1>, body copy sourced from the same
 * DB content the SPA renders, a shared site nav, and pointers to sitemap.xml /
 * llms.txt so an agent landing on any page can crawl outward.
 *
 * Reuses resolveOgData() for per-route metadata (title / description /
 * canonical / OG image). Falls back gracefully: any unhandled route still gets
 * a non-empty document (og.title heading + description + nav), and any DB error
 * degrades to that same fallback rather than throwing.
 *
 * Consumed by:
 *   - GET /api/seo/page?path=  (routes/seo.ts) — the synozur edge (server.mjs)
 *     proxies AI / search / generic bots here.
 *   - socialBotRenderer middleware (secondary net for direct api-server hits).
 */

import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  postsTable,
  servicesTable,
  solutionsTable,
  teamMembersTable,
  eventsTable,
  whitePapersTable,
  faqCategoriesTable,
  faqItemsTable,
  caseStudiesTable,
  workshopsTable,
  collateralTable,
  modelsTable,
  applicationsTable,
} from "@workspace/db";
import { resolveOgData, htmlEscape, SITE_NAME, type OgData } from "./ogResolver";
import { siteOrigin } from "./siteOrigin";
import { ricosToHtml } from "./ricos";

// Primary public sections every rendered page links to, so an agent can crawl
// outward from wherever it landed. Mirrors the SPA's primary nav.
const PRIMARY_NAV: ReadonlyArray<readonly [string, string]> = [
  ["/", "Home"],
  ["/insights", "Insights"],
  ["/team", "Team"],
  ["/events", "Events"],
  ["/about", "About"],
  ["/contact", "Contact"],
  ["/faq", "FAQ"],
];

/**
 * Strip executable / styling markup from first-party CMS HTML before relaying
 * it to third-party agents. Agents don't run JS, but we avoid passing through
 * <script>/<style> blocks, inline event handlers, and javascript: URLs as a
 * hygiene measure.
 */
export function sanitizeCmsHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * SQL fragment matching an artifact's publish window (publishedAt in the past or
 * null, unpublishedAt in the future or null). Mirrors the visibility filters in
 * routes/seo.ts so hub prerenders list exactly what the sitemap lists.
 */
function withinPublishWindow(
  publishedAt: PgColumn,
  unpublishedAt: PgColumn,
): SQL {
  return and(
    sql`(${publishedAt} is null or ${publishedAt} <= now())`,
    sql`(${unpublishedAt} is null or ${unpublishedAt} > now())`,
  ) as SQL;
}

function navHtml(origin: string): string {
  const links = PRIMARY_NAV.map(
    ([href, label]) =>
      `<li><a href="${origin}${href}">${htmlEscape(label)}</a></li>`,
  ).join("");
  return `<nav aria-label="Primary"><ul>${links}</ul></nav>`;
}

function footerHtml(origin: string): string {
  return `<footer>
<p>Discover more from ${htmlEscape(SITE_NAME)}: <a href="${origin}/sitemap.xml">Sitemap</a> · <a href="${origin}/llms.txt">llms.txt</a></p>
</footer>`;
}

/**
 * Wrap resolved metadata + a body fragment into a complete HTML document.
 * Exported for unit testing the document shell without a DB.
 */
export function renderAgentDocument(og: OgData, mainHtml: string): string {
  const t = htmlEscape(og.title);
  const d = htmlEscape(og.description);
  const img = htmlEscape(og.image);
  const url = htmlEscape(og.url);
  const sn = htmlEscape(SITE_NAME);
  const origin = siteOrigin();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="${og.ogType}" />
<meta property="og:site_name" content="${sn}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${img}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
<link rel="canonical" href="${url}" />
</head>
<body>
<header>
<p><a href="${origin}/">${sn}</a></p>
${navHtml(origin)}
</header>
<main>
${mainHtml}
</main>
${footerHtml(origin)}
</body>
</html>`;
}

// ─── Per-route body builders ──────────────────────────────────────────────────
// Each returns an HTML fragment, or "" when there is no content to render (the
// orchestrator then falls back to the generic og title + description body).

async function renderHome(origin: string, og: OgData): Promise<string> {
  const intro = `<h1>${htmlEscape(SITE_NAME)}</h1>\n<p>${htmlEscape(og.description)}</p>`;
  try {
    const rows = await db
      .select({
        title: postsTable.title,
        slug: postsTable.slug,
        excerpt: postsTable.excerpt,
      })
      .from(postsTable)
      .where(and(eq(postsTable.status, "published"), isNull(postsTable.deletedAt)))
      .orderBy(desc(postsTable.publishedAt))
      .limit(10);
    if (!rows.length) return intro;
    const items = rows
      .map(
        (r) =>
          `<li><a href="${origin}/insights/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a>${r.excerpt ? ` — ${htmlEscape(r.excerpt)}` : ""}</li>`,
      )
      .join("\n");
    return `${intro}\n<section><h2>Latest insights</h2><ul>${items}</ul></section>`;
  } catch {
    return intro;
  }
}

async function renderInsightsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: postsTable.title,
      slug: postsTable.slug,
      excerpt: postsTable.excerpt,
      publishedAt: postsTable.publishedAt,
    })
    .from(postsTable)
    .where(and(eq(postsTable.status, "published"), isNull(postsTable.deletedAt)))
    .orderBy(desc(postsTable.publishedAt))
    .limit(50);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const date = fmtDate(r.publishedAt);
      const ex = r.excerpt ? `<p>${htmlEscape(r.excerpt)}</p>` : "";
      return `<li><h2><a href="${origin}/insights/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${date ? `<p><time>${date}</time></p>` : ""}${ex}</li>`;
    })
    .join("\n");
  return `<h1>Insights</h1>\n<ul>${items}</ul>`;
}

async function renderInsightDetail(slug: string, og: OgData): Promise<string> {
  const [post] = await db
    .select({
      excerpt: postsTable.excerpt,
      bodyHtml: postsTable.bodyHtml,
      publishedAt: postsTable.publishedAt,
    })
    .from(postsTable)
    .where(
      and(
        eq(postsTable.slug, slug),
        eq(postsTable.status, "published"),
        isNull(postsTable.deletedAt),
      ),
    )
    .limit(1);
  if (!post) return "";
  const date = fmtDate(post.publishedAt);
  const excerpt = post.excerpt ? `<p>${htmlEscape(post.excerpt)}</p>` : "";
  const body = sanitizeCmsHtml(post.bodyHtml);
  return `<h1>${htmlEscape(og.title)}</h1>${date ? `<p><time>${date}</time></p>` : ""}${excerpt}<article>${body}</article>`;
}

async function renderServiceDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      heroTextHtml: servicesTable.heroTextHtml,
      blurbHtml: servicesTable.blurbHtml,
      secondaryTextHtml: servicesTable.secondaryTextHtml,
      tertiaryTextHtml: servicesTable.tertiaryTextHtml,
    })
    .from(servicesTable)
    .where(
      and(
        eq(servicesTable.slug, slug),
        eq(servicesTable.status, "published"),
        isNull(servicesTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return "";
  const body = [
    row.blurbHtml,
    row.heroTextHtml,
    row.secondaryTextHtml,
    row.tertiaryTextHtml,
  ]
    .map(sanitizeCmsHtml)
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

async function renderSolutionDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      heroTextHtml: solutionsTable.heroTextHtml,
      blurbHtml: solutionsTable.blurbHtml,
      secondaryTextHtml: solutionsTable.secondaryTextHtml,
      ourApproachTextHtml: solutionsTable.ourApproachTextHtml,
      acceleratorsHtml: solutionsTable.acceleratorsHtml,
    })
    .from(solutionsTable)
    .where(
      and(
        eq(solutionsTable.slug, slug),
        eq(solutionsTable.status, "published"),
        isNull(solutionsTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return "";
  const body = [
    row.blurbHtml,
    row.heroTextHtml,
    row.secondaryTextHtml,
    row.ourApproachTextHtml,
    row.acceleratorsHtml,
  ]
    .map(sanitizeCmsHtml)
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

async function renderWhitePaperDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({ bodyHtml: whitePapersTable.bodyHtml })
    .from(whitePapersTable)
    .where(
      and(
        eq(whitePapersTable.slug, slug),
        eq(whitePapersTable.status, "published"),
        isNull(whitePapersTable.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return "";
  const body = sanitizeCmsHtml(row.bodyHtml);
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

async function renderTeamList(origin: string): Promise<string> {
  const rows = await db
    .select({
      name: teamMembersTable.name,
      slug: teamMembersTable.slug,
      jobTitle: teamMembersTable.jobTitle,
      shortDescription: teamMembersTable.shortDescription,
    })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.active, true))
    .orderBy(asc(teamMembersTable.manualSort), asc(teamMembersTable.name))
    .limit(200);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const job = r.jobTitle ? `<p>${htmlEscape(r.jobTitle)}</p>` : "";
      // shortDescription may contain CMS HTML (Wix markup) — sanitize rather
      // than escape so agents read real prose, not literal &lt;p&gt; tags.
      const bioHtml = sanitizeCmsHtml(r.shortDescription);
      const bio = bioHtml ? `<div>${bioHtml}</div>` : "";
      return `<li><h2><a href="${origin}/team/${encodeURIComponent(r.slug)}">${htmlEscape(r.name)}</a></h2>${job}${bio}</li>`;
    })
    .join("\n");
  return `<h1>Team</h1>\n<ul>${items}</ul>`;
}

async function renderTeamDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      jobTitle: teamMembersTable.jobTitle,
      shortDescription: teamMembersTable.shortDescription,
      longDescription: teamMembersTable.longDescription,
    })
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.slug, slug), eq(teamMembersTable.active, true)))
    .limit(1);
  if (!row) return "";
  const job = row.jobTitle ? `<p>${htmlEscape(row.jobTitle)}</p>` : "";
  // longDescription is Wix Ricos JSON (matches the public /team-members/:slug
  // route, which also runs it through ricosToHtml); shortDescription is CMS HTML.
  const bio =
    sanitizeCmsHtml(ricosToHtml(row.longDescription)) ||
    sanitizeCmsHtml(row.shortDescription);
  return `<h1>${htmlEscape(og.title)}</h1>${job}<article>${bio}</article>`;
}

async function renderEventsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: eventsTable.title,
      slug: eventsTable.slug,
      startDate: eventsTable.startDate,
      location: eventsTable.location,
      teaser: eventsTable.teaser,
    })
    .from(eventsTable)
    .orderBy(desc(eventsTable.startDate))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const date = fmtDate(r.startDate);
      const meta = [date, r.location ? htmlEscape(r.location) : ""]
        .filter(Boolean)
        .join(" · ");
      const teaser = r.teaser ? `<p>${htmlEscape(r.teaser)}</p>` : "";
      return `<li><h2><a href="${origin}/events/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${meta ? `<p>${meta}</p>` : ""}${teaser}</li>`;
    })
    .join("\n");
  return `<h1>Events</h1>\n<ul>${items}</ul>`;
}

async function renderEventDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      startDate: eventsTable.startDate,
      location: eventsTable.location,
      description: eventsTable.description,
      teaser: eventsTable.teaser,
    })
    .from(eventsTable)
    .where(eq(eventsTable.slug, slug))
    .limit(1);
  if (!row) return "";
  const date = fmtDate(row.startDate);
  const meta = [date, row.location ? htmlEscape(row.location) : ""]
    .filter(Boolean)
    .join(" · ");
  const body =
    sanitizeCmsHtml(row.description) ||
    (row.teaser ? `<p>${htmlEscape(row.teaser)}</p>` : "") ||
    (og.description ? `<p>${htmlEscape(og.description)}</p>` : "");
  return `<h1>${htmlEscape(og.title)}</h1>${meta ? `<p>${meta}</p>` : ""}${body ? `<article>${body}</article>` : ""}`;
}

async function renderFaqList(): Promise<string> {
  const [cats, items] = await Promise.all([
    db
      .select({
        id: faqCategoriesTable.id,
        name: faqCategoriesTable.name,
        description: faqCategoriesTable.description,
      })
      .from(faqCategoriesTable)
      .where(
        and(
          eq(faqCategoriesTable.status, "published"),
          isNull(faqCategoriesTable.deletedAt),
        ),
      )
      .orderBy(asc(faqCategoriesTable.displayOrder)),
    db
      .select({
        categoryId: faqItemsTable.categoryId,
        question: faqItemsTable.question,
        answerHtml: faqItemsTable.answerHtml,
      })
      .from(faqItemsTable)
      .where(
        and(
          eq(faqItemsTable.status, "published"),
          isNull(faqItemsTable.deletedAt),
        ),
      )
      .orderBy(asc(faqItemsTable.displayOrder)),
  ]);
  if (!cats.length) return "";
  const byCat = new Map<string, { question: string; answerHtml: string }[]>();
  for (const it of items) {
    const list = byCat.get(it.categoryId) ?? [];
    list.push({ question: it.question, answerHtml: it.answerHtml });
    byCat.set(it.categoryId, list);
  }
  const sections = cats
    .map((c) => {
      const qa = (byCat.get(c.id) ?? [])
        .map(
          (it) =>
            `<h3>${htmlEscape(it.question)}</h3><div>${sanitizeCmsHtml(it.answerHtml)}</div>`,
        )
        .join("\n");
      if (!qa) return "";
      const desc = c.description ? `<p>${htmlEscape(c.description)}</p>` : "";
      return `<section><h2>${htmlEscape(c.name)}</h2>${desc}${qa}</section>`;
    })
    .filter(Boolean)
    .join("\n");
  if (!sections) return "";
  return `<h1>Frequently Asked Questions</h1>\n${sections}`;
}

async function renderSolutionsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: solutionsTable.title,
      slug: solutionsTable.slug,
      blurbCopy: solutionsTable.blurbCopy,
      blurbHtml: solutionsTable.blurbHtml,
    })
    .from(solutionsTable)
    .where(
      and(
        isNull(solutionsTable.deletedAt),
        eq(solutionsTable.active, true),
        eq(solutionsTable.status, "published"),
        withinPublishWindow(
          solutionsTable.publishedAt,
          solutionsTable.unpublishedAt,
        ),
      ),
    )
    .orderBy(asc(solutionsTable.displayOrder))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const blurb =
        (r.blurbCopy ? `<p>${htmlEscape(r.blurbCopy)}</p>` : "") ||
        (r.blurbHtml ? `<div>${sanitizeCmsHtml(r.blurbHtml)}</div>` : "");
      return `<li><h2><a href="${origin}/solutions/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${blurb}</li>`;
    })
    .join("\n");
  return `<h1>Solutions</h1>\n<ul>${items}</ul>`;
}

async function renderCaseStudiesList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: caseStudiesTable.title,
      slug: caseStudiesTable.slug,
      headline: caseStudiesTable.headline,
      summary: caseStudiesTable.summary,
      industry: caseStudiesTable.industry,
      client: caseStudiesTable.client,
      publishedAt: caseStudiesTable.publishedAt,
    })
    .from(caseStudiesTable)
    .where(
      and(
        isNull(caseStudiesTable.deletedAt),
        eq(caseStudiesTable.active, true),
        eq(caseStudiesTable.status, "published"),
        withinPublishWindow(
          caseStudiesTable.publishedAt,
          caseStudiesTable.unpublishedAt,
        ),
      ),
    )
    .orderBy(desc(caseStudiesTable.publishedAt))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const meta = [r.client, r.industry].filter(Boolean).map(htmlEscape).join(" · ");
      const blurb = r.headline || r.summary;
      const body = blurb ? `<p>${htmlEscape(blurb)}</p>` : "";
      return `<li><h2><a href="${origin}/case-studies/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${meta ? `<p>${meta}</p>` : ""}${body}</li>`;
    })
    .join("\n");
  return `<h1>Case Studies</h1>\n<ul>${items}</ul>`;
}

async function renderWorkshopsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: workshopsTable.title,
      slug: workshopsTable.slug,
      category: workshopsTable.category,
      shortDescription: workshopsTable.shortDescription,
    })
    .from(workshopsTable)
    .where(and(isNull(workshopsTable.deletedAt), eq(workshopsTable.active, true)))
    .orderBy(asc(workshopsTable.title))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const cat = r.category ? `<p>${htmlEscape(r.category)}</p>` : "";
      const desc = r.shortDescription
        ? `<p>${htmlEscape(r.shortDescription)}</p>`
        : "";
      return `<li><h2><a href="${origin}/workshops/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${cat}${desc}</li>`;
    })
    .join("\n");
  return `<h1>Workshops</h1>\n<ul>${items}</ul>`;
}

async function renderModelsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: modelsTable.title,
      slug: modelsTable.slug,
      shortDescription: modelsTable.shortDescription,
    })
    .from(modelsTable)
    .where(
      and(
        isNull(modelsTable.deletedAt),
        eq(modelsTable.active, true),
        eq(modelsTable.status, "published"),
        withinPublishWindow(modelsTable.publishedAt, modelsTable.unpublishedAt),
      ),
    )
    .orderBy(asc(modelsTable.title))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const desc = r.shortDescription
        ? `<p>${htmlEscape(r.shortDescription)}</p>`
        : "";
      return `<li><h2><a href="${origin}/models/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${desc}</li>`;
    })
    .join("\n");
  return `<h1>Models</h1>\n<ul>${items}</ul>`;
}

async function renderApplicationsList(origin: string): Promise<string> {
  const rows = await db
    .select({
      title: applicationsTable.title,
      name: applicationsTable.name,
      slug: applicationsTable.slug,
      tagline: applicationsTable.tagline,
      shortSummary: applicationsTable.shortSummary,
    })
    .from(applicationsTable)
    .where(
      and(
        isNull(applicationsTable.deletedAt),
        eq(applicationsTable.active, true),
        eq(applicationsTable.status, "published"),
        withinPublishWindow(
          applicationsTable.publishedAt,
          applicationsTable.unpublishedAt,
        ),
      ),
    )
    .orderBy(asc(applicationsTable.title))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const label = r.name || r.title;
      const desc =
        (r.tagline ? `<p>${htmlEscape(r.tagline)}</p>` : "") ||
        (r.shortSummary ? `<p>${htmlEscape(r.shortSummary)}</p>` : "");
      return `<li><h2><a href="${origin}/applications/${encodeURIComponent(r.slug)}">${htmlEscape(label)}</a></h2>${desc}</li>`;
    })
    .join("\n");
  return `<h1>Applications</h1>\n<ul>${items}</ul>`;
}

// Collateral rows that don't have their own public landing routes under
// /library (mirrors routes/seo.ts sitemap logic).
const LIBRARY_EXCLUDED_TYPES = ["case_study", "event", "insight"] as const;

async function renderCollateralList(
  origin: string,
  opts: { heading: string; routeBase: string; where: SQL },
): Promise<string> {
  const rows = await db
    .select({
      title: collateralTable.title,
      slug: collateralTable.slug,
      subtitle: collateralTable.subtitle,
      description: collateralTable.description,
      type: collateralTable.type,
      publishedAt: collateralTable.publishedAt,
    })
    .from(collateralTable)
    .where(opts.where)
    .orderBy(desc(collateralTable.publishedAt))
    .limit(100);
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      const desc =
        (r.subtitle ? `<p>${htmlEscape(r.subtitle)}</p>` : "") ||
        (r.description ? `<p>${htmlEscape(r.description)}</p>` : "");
      return `<li><h2><a href="${origin}${opts.routeBase}/${encodeURIComponent(r.slug)}">${htmlEscape(r.title)}</a></h2>${desc}</li>`;
    })
    .join("\n");
  return `<h1>${htmlEscape(opts.heading)}</h1>\n<ul>${items}</ul>`;
}

function renderLibraryList(origin: string): Promise<string> {
  return renderCollateralList(origin, {
    heading: "Library",
    routeBase: "/library",
    where: and(
      isNull(collateralTable.deletedAt),
      eq(collateralTable.active, true),
      notInArray(collateralTable.type, [...LIBRARY_EXCLUDED_TYPES]),
    ) as SQL,
  });
}

function renderWebinarsList(origin: string): Promise<string> {
  return renderCollateralList(origin, {
    heading: "Webinars",
    routeBase: "/webinars",
    where: and(
      isNull(collateralTable.deletedAt),
      eq(collateralTable.active, true),
      eq(collateralTable.type, "webinar"),
    ) as SQL,
  });
}

// ─── Detail renderers ─────────────────────────────────────────────────────────

// Render one narrative section ({heading, body[], bullets?}) shared by the
// case-study challenge / approach / outcome blocks. Body entries are plain
// text paragraphs (escaped), not HTML.
function renderNarrativeSection(
  sec:
    | { heading?: string | null; body?: string[] | null; bullets?: string[] | null }
    | null
    | undefined,
): string {
  if (!sec) return "";
  const heading = sec.heading ? `<h2>${htmlEscape(sec.heading)}</h2>` : "";
  const paras = (sec.body ?? [])
    .filter(Boolean)
    .map((p) => `<p>${htmlEscape(p)}</p>`)
    .join("");
  const bulletItems = (sec.bullets ?? []).filter(Boolean);
  const bullets = bulletItems.length
    ? `<ul>${bulletItems.map((b) => `<li>${htmlEscape(b)}</li>`).join("")}</ul>`
    : "";
  if (!heading && !paras && !bullets) return "";
  return `${heading}${paras}${bullets}`;
}

function bulletSection(
  header: string | null | undefined,
  items: (string | null | undefined)[] | null | undefined,
): string {
  const list = (items ?? []).filter((i): i is string => Boolean(i));
  if (!list.length) return "";
  const h = header ? `<h2>${htmlEscape(header)}</h2>` : "";
  return `${h}<ul>${list.map((i) => `<li>${htmlEscape(i)}</li>`).join("")}</ul>`;
}

async function renderCaseStudyDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      client: caseStudiesTable.client,
      industry: caseStudiesTable.industry,
      headline: caseStudiesTable.headline,
      summary: caseStudiesTable.summary,
      challenge: caseStudiesTable.challenge,
      approach: caseStudiesTable.approach,
      outcome: caseStudiesTable.outcome,
      metrics: caseStudiesTable.metrics,
      quoteText: caseStudiesTable.quoteText,
      quoteAttribution: caseStudiesTable.quoteAttribution,
    })
    .from(caseStudiesTable)
    .where(
      and(
        eq(caseStudiesTable.slug, slug),
        isNull(caseStudiesTable.deletedAt),
        eq(caseStudiesTable.active, true),
        eq(caseStudiesTable.status, "published"),
        withinPublishWindow(
          caseStudiesTable.publishedAt,
          caseStudiesTable.unpublishedAt,
        ),
      ),
    )
    .limit(1);
  if (!row) return "";
  const meta = [row.client, row.industry]
    .filter(Boolean)
    .map(htmlEscape)
    .join(" · ");
  const intro =
    (row.headline ? `<p>${htmlEscape(row.headline)}</p>` : "") +
    (row.summary ? `<p>${htmlEscape(row.summary)}</p>` : "");
  const challenge = renderNarrativeSection(row.challenge);
  const approach = (row.approach ?? [])
    .map(renderNarrativeSection)
    .filter(Boolean)
    .join("\n");
  const outcome = renderNarrativeSection(row.outcome);
  const metricItems = (row.metrics ?? []).filter((m) => m && (m.label || m.value));
  const metrics = metricItems.length
    ? `<ul>${metricItems
        .map(
          (m) =>
            `<li>${htmlEscape([m.value, m.label].filter(Boolean).join(" — "))}</li>`,
        )
        .join("")}</ul>`
    : "";
  const quote = row.quoteText
    ? `<blockquote><p>${htmlEscape(row.quoteText)}</p>${row.quoteAttribution ? `<cite>${htmlEscape(row.quoteAttribution)}</cite>` : ""}</blockquote>`
    : "";
  const body = [intro, challenge, approach, outcome, metrics, quote]
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1>${meta ? `<p>${meta}</p>` : ""}<article>${body}</article>`;
}

async function renderWorkshopDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      shortDescription: workshopsTable.shortDescription,
      heroSubhead: workshopsTable.heroSubhead,
      pain: workshopsTable.pain,
      scope: workshopsTable.scope,
      process: workshopsTable.process,
      deliverables: workshopsTable.deliverables,
      outcomes: workshopsTable.outcomes,
      faq: workshopsTable.faq,
    })
    .from(workshopsTable)
    .where(
      and(
        eq(workshopsTable.slug, slug),
        isNull(workshopsTable.deletedAt),
        eq(workshopsTable.active, true),
      ),
    )
    .limit(1);
  if (!row) return "";
  const intro = [row.heroSubhead, row.shortDescription]
    .filter(Boolean)
    .map((p) => `<p>${htmlEscape(p)}</p>`)
    .join("");
  const pain = row.pain
    ? `${row.pain.header ? `<h2>${htmlEscape(row.pain.header)}</h2>` : ""}${row.pain.lead ? `<p>${htmlEscape(row.pain.lead)}</p>` : ""}${bulletSection(null, row.pain.tiles)}`
    : "";
  const scope = row.scope
    ? `${row.scope.header ? `<h2>${htmlEscape(row.scope.header)}</h2>` : ""}${row.scope.summary ? `<p>${htmlEscape(row.scope.summary)}</p>` : ""}${bulletSection(null, row.scope.bullets)}`
    : "";
  const process = bulletSection(row.process?.header, row.process?.steps);
  const deliverables = row.deliverables
    ? bulletSection(row.deliverables.header, [
        ...(row.deliverables.core ?? []),
        ...(row.deliverables.executive ?? []),
        ...(row.deliverables.enablement ?? []),
        ...(row.deliverables.addOns ?? []),
      ])
    : "";
  const outcomes = bulletSection(row.outcomes?.header, row.outcomes?.bullets);
  const faqItems = row.faq?.items ?? [];
  const faq = faqItems.length
    ? `${row.faq?.header ? `<h2>${htmlEscape(row.faq.header)}</h2>` : ""}${faqItems.map((it) => `<h3>${htmlEscape(it.q)}</h3><p>${htmlEscape(it.a)}</p>`).join("")}`
    : "";
  const body = [intro, pain, scope, process, deliverables, outcomes, faq]
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

async function renderModelDetail(slug: string, og: OgData): Promise<string> {
  const [row] = await db
    .select({
      shortDescription: modelsTable.shortDescription,
      longDescriptionHtml: modelsTable.longDescriptionHtml,
      dimensionsHtml: modelsTable.dimensionsHtml,
    })
    .from(modelsTable)
    .where(
      and(
        eq(modelsTable.slug, slug),
        isNull(modelsTable.deletedAt),
        eq(modelsTable.active, true),
        eq(modelsTable.status, "published"),
        withinPublishWindow(modelsTable.publishedAt, modelsTable.unpublishedAt),
      ),
    )
    .limit(1);
  if (!row) return "";
  const intro = row.shortDescription
    ? `<p>${htmlEscape(row.shortDescription)}</p>`
    : "";
  const body = [
    intro,
    sanitizeCmsHtml(row.longDescriptionHtml),
    sanitizeCmsHtml(row.dimensionsHtml),
  ]
    .filter(Boolean)
    .join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

async function renderApplicationDetail(
  slug: string,
  og: OgData,
): Promise<string> {
  const [row] = await db
    .select({
      tagline: applicationsTable.tagline,
      shortSummary: applicationsTable.shortSummary,
      descriptionParagraphs: applicationsTable.descriptionParagraphs,
    })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.slug, slug),
        isNull(applicationsTable.deletedAt),
        eq(applicationsTable.active, true),
        eq(applicationsTable.status, "published"),
        withinPublishWindow(
          applicationsTable.publishedAt,
          applicationsTable.unpublishedAt,
        ),
      ),
    )
    .limit(1);
  if (!row) return "";
  const intro = [row.tagline, row.shortSummary]
    .filter(Boolean)
    .map((p) => `<p>${htmlEscape(p)}</p>`)
    .join("");
  const paras = (row.descriptionParagraphs ?? [])
    .filter(Boolean)
    .map((p) => `<p>${htmlEscape(p)}</p>`)
    .join("");
  const body = [intro, paras].filter(Boolean).join("\n");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

// Backs both /library/:slug and /webinars/:slug — a single collateral row keyed
// by slug. Visibility mirrors the collateral list renderers AND the sitemap: a
// webinar route requires type='webinar'; a library route excludes the same
// LIBRARY_EXCLUDED_TYPES the list/sitemap skip. Without the per-route type
// guard, bots could get a full body on a route the hub/sitemap intentionally
// omits.
async function renderCollateralDetail(
  slug: string,
  og: OgData,
  section: "library" | "webinars",
): Promise<string> {
  const typeFilter =
    section === "webinars"
      ? eq(collateralTable.type, "webinar")
      : notInArray(collateralTable.type, [...LIBRARY_EXCLUDED_TYPES]);
  const [row] = await db
    .select({
      subtitle: collateralTable.subtitle,
      description: collateralTable.description,
    })
    .from(collateralTable)
    .where(
      and(
        eq(collateralTable.slug, slug),
        isNull(collateralTable.deletedAt),
        eq(collateralTable.active, true),
        typeFilter,
      ),
    )
    .limit(1);
  if (!row) return "";
  const body =
    [
      row.subtitle ? `<p>${htmlEscape(row.subtitle)}</p>` : "",
      row.description ? `<p>${htmlEscape(row.description)}</p>` : "",
    ]
      .filter(Boolean)
      .join("\n") ||
    (og.description ? `<p>${htmlEscape(og.description)}</p>` : "");
  if (!body) return "";
  return `<h1>${htmlEscape(og.title)}</h1><article>${body}</article>`;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function renderMainContent(
  pathname: string,
  og: OgData,
  origin: string,
): Promise<string> {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return renderHome(origin, og);

  const parts = clean.replace(/^\//, "").split("/");
  const section = parts[0] ?? "";
  const slug = parts[1] ?? "";

  if (!slug) {
    switch (section) {
      case "insights":
        return renderInsightsList(origin);
      case "team":
        return renderTeamList(origin);
      case "events":
        return renderEventsList(origin);
      case "faq":
        return renderFaqList();
      case "solutions":
        return renderSolutionsList(origin);
      case "case-studies":
        return renderCaseStudiesList(origin);
      case "workshops":
        return renderWorkshopsList(origin);
      case "models":
        return renderModelsList(origin);
      case "applications":
        return renderApplicationsList(origin);
      case "library":
        return renderLibraryList(origin);
      case "webinars":
        return renderWebinarsList(origin);
      default:
        return "";
    }
  }

  switch (section) {
    case "insights":
      return renderInsightDetail(slug, og);
    case "services":
    case "services-overview":
      return renderServiceDetail(slug, og);
    case "solutions":
      return renderSolutionDetail(slug, og);
    case "team":
      return renderTeamDetail(slug, og);
    case "events":
      return renderEventDetail(slug, og);
    case "white-papers":
      return renderWhitePaperDetail(slug, og);
    case "case-studies":
      return renderCaseStudyDetail(slug, og);
    case "workshops":
      return renderWorkshopDetail(slug, og);
    case "models":
      return renderModelDetail(slug, og);
    case "applications":
      return renderApplicationDetail(slug, og);
    case "library":
      return renderCollateralDetail(slug, og, "library");
    case "webinars":
      return renderCollateralDetail(slug, og, "webinars");
    default:
      return "";
  }
}

/**
 * Build a complete, content-rich HTML document for the given public pathname.
 * Always resolves to a non-empty document — unhandled routes and DB errors
 * degrade to the resolved title + description + site nav.
 */
export async function buildAgentPageHtml(pathname: string): Promise<string> {
  const og = await resolveOgData(pathname);
  const origin = siteOrigin();
  let main = "";
  try {
    main = await renderMainContent(pathname, og, origin);
  } catch {
    main = "";
  }
  if (!main) {
    main = `<h1>${htmlEscape(og.title)}</h1>\n<p>${htmlEscape(og.description)}</p>`;
  }
  return renderAgentDocument(og, main);
}
