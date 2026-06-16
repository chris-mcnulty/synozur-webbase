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

import { and, asc, desc, eq, isNull } from "drizzle-orm";
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
