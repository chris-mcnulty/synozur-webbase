import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql, eq, desc, and, gte, count } from "drizzle-orm";
import {
  db,
  searchQueriesTable,
  siteSettingsTable,
} from "@workspace/db";
import { requireCapability } from "../middlewares/auth";
import { buildTsqueryExpr } from "./search.synonyms";

export { buildTsqueryExpr, SYNONYM_GROUPS } from "./search.synonyms";

// #170 — Public-site search via Postgres FTS.
//
// One UNION ALL query across every published artifact kind, ranked by
// `ts_rank_cd(search_tsv, query) * kind_boost`. Kind boosts come from
// `site_settings.search_kind_boosts` (jsonb) when set; otherwise the
// hard-coded defaults below win — those defaults nudge commercial pages
// (services, solutions) above blog posts on equal-relevance ties.

const router: IRouter = Router();

export const SEARCH_KINDS = [
  "post",
  "case_study",
  "white_paper",
  "service",
  "solution",
  "faq",
  "polaris_episode",
  "application",
  "model",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

const DEFAULT_KIND_BOOSTS: Record<SearchKind, number> = {
  post: 1.0,
  case_study: 1.2,
  white_paper: 1.1,
  service: 1.5,
  solution: 1.5,
  faq: 1.0,
  polaris_episode: 1.0,
  application: 1.2,
  model: 1.1,
};

// URL builder per kind; the public page paths the SPA actually serves.
const KIND_URL: Record<SearchKind, (slug: string) => string> = {
  post: (s) => `/insights/${s}`,
  case_study: (s) => `/case-studies/${s}`,
  white_paper: (s) => `/white-papers/${s}`,
  service: (s) => `/services/${s}`,
  solution: (s) => `/solutions/${s}`,
  // `s` is already shaped as "<category-slug>/<item-slug>" by the FAQ
  // subselect above, so this resolves to /faq/<category>/<item> — the
  // live FAQ route's path-based deep link to the answer.
  faq: (s) => `/faq/${s}`,
  polaris_episode: (s) => `/polaris/${s}`,
  application: (s) => `/applications/${s}`,
  model: (s) => `/models/${s}`,
};

// Per-kind FROM/select shape. The visibility predicate differs slightly
// between `posts` (no `active`/`unpublished_at` columns) and the rest of
// the artifact tables that ship the shared `_artifactBase` lifecycle.
type KindSpec = {
  kind: SearchKind;
  table: string;
  titleExpr: string; // SQL expression yielding the display title
  visibility: string; // SQL fragment used in WHERE
};

const KIND_SPECS: KindSpec[] = [
  {
    kind: "post",
    table: "posts",
    titleExpr: "title",
    visibility: "deleted_at IS NULL AND status = 'published' AND published_at <= now()",
  },
  {
    kind: "case_study",
    table: "case_studies",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "white_paper",
    table: "white_papers",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "service",
    table: "services",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "solution",
    table: "solutions",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "faq",
    table: "faq_items",
    titleExpr: "question",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "polaris_episode",
    table: "polaris_episodes",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "application",
    table: "applications",
    titleExpr: "COALESCE(NULLIF(name, ''), title)",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
  {
    kind: "model",
    table: "models",
    titleExpr: "title",
    visibility:
      "active = true AND deleted_at IS NULL AND status = 'published' AND (published_at IS NULL OR published_at <= now()) AND (unpublished_at IS NULL OR unpublished_at > now())",
  },
];

const KIND_SPEC_BY_KIND: Record<SearchKind, KindSpec> = Object.fromEntries(
  KIND_SPECS.map((s) => [s.kind, s]),
) as Record<SearchKind, KindSpec>;

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

async function loadKindBoosts(): Promise<Record<SearchKind, number>> {
  const [row] = await db
    .select({ boosts: siteSettingsTable.searchKindBoosts })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  const stored = row?.boosts ?? null;
  const out: Record<SearchKind, number> = { ...DEFAULT_KIND_BOOSTS };
  if (stored && typeof stored === "object") {
    for (const k of SEARCH_KINDS) {
      const v = (stored as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        out[k] = v;
      }
    }
  }
  return out;
}

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  kind: z
    .union([z.enum(SEARCH_KINDS), z.literal("all")])
    .optional()
    .default("all"),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
  cursor: z.string().optional(),
});

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed?.offset === "number" && parsed.offset >= 0) return parsed.offset;
  } catch {
    /* fall through */
  }
  return 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

// GET /api/search?q=&kind=&limit=&cursor=
router.get("/search", async (req, res) => {
  const parsed = SearchQuery.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const { q, kind, limit, cursor } = parsed.data;
  const offset = decodeCursor(cursor);
  const boosts = await loadKindBoosts();

  const enabled: KindSpec[] =
    kind === "all" ? KIND_SPECS : [KIND_SPEC_BY_KIND[kind]];

  // Build UNION ALL of one SELECT per enabled kind. Each subselect:
  //   SELECT '<kind>'::text AS kind, id::text, slug, <title> AS title,
  //          ts_headline('english', <body_text>, q.query, 'opts') AS excerpt_html,
  //          ts_rank_cd(search_tsv, q.query) * <boost> AS rank
  //   FROM <table>, q
  //   WHERE search_tsv @@ q.query AND <visibility>
  // Headline is built from the same body expression we tokenized into
  // search_tsv (HTML-stripped, JSON-flattened) so the highlighted excerpt
  // is human-readable rather than markup-y.

  const headlineOpts =
    "StartSel=<mark>,StopSel=</mark>,MaxWords=30,MinWords=15,ShortWord=3,HighlightAll=false,MaxFragments=1,FragmentDelimiter=...";

  const headlineSourceFor = (table: string): string => {
    switch (table) {
      case "posts":
        return `regexp_replace(coalesce(excerpt, '') || ' ' || coalesce(body_html, '') || ' ' || coalesce(body_markdown, ''), '<[^>]+>', ' ', 'g')`;
      case "case_studies":
        return `coalesce(summary, '') || ' ' || coalesce(headline, '') || ' ' || translate(coalesce(challenge::text,'') || ' ' || coalesce(approach::text,'') || ' ' || coalesce(outcome::text,''), '<>"[]{},', '        ')`;
      case "white_papers":
        return `coalesce(short_description, '') || ' ' || regexp_replace(coalesce(body_html,''), '<[^>]+>', ' ', 'g')`;
      case "services":
        return `regexp_replace(coalesce(blurb_html,'') || ' ' || coalesce(hero_text_html,'') || ' ' || coalesce(secondary_text_html,''), '<[^>]+>', ' ', 'g')`;
      case "solutions":
        return `coalesce(blurb_copy,'') || ' ' || regexp_replace(coalesce(blurb_html,'') || ' ' || coalesce(hero_text_html,'') || ' ' || coalesce(secondary_text_html,''), '<[^>]+>', ' ', 'g')`;
      case "faq_items":
        return `coalesce(seo_description,'') || ' ' || regexp_replace(coalesce(answer_html,''), '<[^>]+>', ' ', 'g')`;
      case "polaris_episodes":
        return `coalesce(summary,'') || ' ' || regexp_replace(coalesce(transcript_html,''), '<[^>]+>', ' ', 'g')`;
      case "applications":
        return `coalesce(tagline,'') || ' ' || coalesce(short_summary,'') || ' ' || translate(coalesce(description_paragraphs::text,''), '<>"[]{},', '        ')`;
      case "models":
        return `coalesce(short_description,'') || ' ' || regexp_replace(coalesce(long_description_html,''), '<[^>]+>', ' ', 'g')`;
      default:
        return "''";
    }
  };

  // We embed the boost as a numeric literal — they're server-controlled.
  const safeBoost = (k: SearchKind): string => {
    const b = boosts[k];
    if (!Number.isFinite(b) || b <= 0) return "1";
    return Number(b).toFixed(4);
  };

  const subselects = enabled.map((spec) => {
    const headlineSource = headlineSourceFor(spec.table);
    // FAQ items live under `/faq/<category-slug>/<item-slug>` on the
    // public site, so the search row needs the parent category slug
    // baked in. Build a category-qualified slug here and let the URL
    // builder (KIND_URL.faq) treat it as a path fragment — that way the
    // rest of the UNION pipeline stays slug-shaped.
    if (spec.table === "faq_items") {
      return `
        SELECT
          '${spec.kind}'::text AS kind,
          faq_items.id::text AS id,
          (faq_categories.slug || '/' || faq_items.slug) AS slug,
          (${spec.titleExpr})::text AS title,
          ts_headline('english', ${headlineSource}, q.query,
            '${headlineOpts}') AS excerpt_html,
          ts_rank_cd(faq_items.search_tsv, q.query) * ${safeBoost(spec.kind)} AS rank
        FROM faq_items
        JOIN faq_categories ON faq_categories.id = faq_items.category_id
        CROSS JOIN q
        WHERE faq_items.search_tsv @@ q.query
          AND faq_categories.active = true
          AND faq_categories.deleted_at IS NULL
          AND faq_categories.status = 'published'
          AND (faq_categories.published_at IS NULL OR faq_categories.published_at <= now())
          AND (faq_categories.unpublished_at IS NULL OR faq_categories.unpublished_at > now())
          AND (${spec.visibility.replace(/(\b)(active|deleted_at|status|published_at|unpublished_at)\b/g, "faq_items.$2")})
      `;
    }
    return `
      SELECT
        '${spec.kind}'::text AS kind,
        ${spec.table}.id::text AS id,
        ${spec.table}.slug AS slug,
        (${spec.titleExpr})::text AS title,
        ts_headline('english', ${headlineSource}, q.query,
          '${headlineOpts}') AS excerpt_html,
        ts_rank_cd(${spec.table}.search_tsv, q.query) * ${safeBoost(spec.kind)} AS rank
      FROM ${spec.table}, q
      WHERE ${spec.table}.search_tsv @@ q.query
        AND (${spec.visibility})
    `;
  });

  // Single round-trip: `q` CTE computes the synonym-expanded tsquery,
  // `matches` materialises the UNION ALL across kinds (so the total
  // count and the page slice both read from the same row set without
  // re-running the search), then the outer SELECT paginates and tags
  // every row with the same `total_count` scalar for the UI.
  const tsqueryExpr = buildTsqueryExpr(q);
  const fullSql = `
    WITH q AS (SELECT ${tsqueryExpr} AS query),
    matches AS (
      ${subselects.join("\nUNION ALL\n")}
    )
    SELECT *, (SELECT COUNT(*) FROM matches)::int AS total_count
    FROM matches
    ORDER BY rank DESC, kind ASC, id ASC
    OFFSET ${offset}
    LIMIT ${limit + 1}
  `;

  let rows: Array<{
    kind: SearchKind;
    id: string;
    slug: string;
    title: string;
    excerpt_html: string;
    rank: number;
    total_count: number | string;
  }>;
  try {
    const result = await db.execute(sql.raw(fullSql));
    rows = (result as unknown as { rows: typeof rows }).rows ?? (result as unknown as typeof rows);
  } catch (err) {
    req.log?.error({ err, q }, "Search query failed");
    res.status(500).json({ error: "Search failed" });
    return;
  }

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const items = trimmed.map((r) => {
    const excerptHtml = r.excerpt_html ?? "";
    return {
      kind: r.kind,
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerptHtml,
      // Plain-text excerpt with the <mark> wrappers stripped, kept alongside
      // `excerptHtml` so consumers that can't render highlight markup
      // (notably the 404-page search input from #163) still get a clean
      // snippet.
      excerpt: excerptHtml.replace(/<\/?mark>/g, ""),
      rankScore: Number(r.rank),
      url: KIND_URL[r.kind](r.slug),
    };
  });
  const nextCursor = hasMore ? encodeCursor(offset + limit) : null;
  // `total_count` is the same scalar on every row of `matches`; if the
  // page is empty we don't know it from this query, so the client keeps
  // whatever it already cached from page 0.
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : null;

  // Telemetry: one row per request on the first page only (offset=0) —
  // pagination loads shouldn't double-count the same query.
  let searchId: string | null = null;
  if (offset === 0) {
    try {
      const [logged] = await db
        .insert(searchQueriesTable)
        .values({
          query: q,
          queryNormalized: normalizeQuery(q),
          // Use the true total so the zero-result-queries report reflects
          // empty searches (not "had a first page but maybe more").
          resultCount: totalCount ?? 0,
        })
        .returning({ id: searchQueriesTable.id });
      searchId = logged?.id ?? null;
    } catch (err) {
      req.log?.warn({ err }, "search telemetry insert failed");
    }
  }

  res.json({
    items,
    nextCursor,
    totalCount,
    searchId,
    boosts,
  });
});

// POST /api/search/click — telemetry update when a visitor clicks a hit.
const ClickBody = z.object({
  searchId: z.string().uuid(),
  clickedKind: z.enum(SEARCH_KINDS),
  clickedRank: z.number().int().min(0),
  clickedSlug: z.string().min(1).max(200),
});
router.post("/search/click", async (req, res) => {
  const parsed = ClickBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { searchId, clickedKind, clickedRank, clickedSlug } = parsed.data;
  try {
    await db
      .update(searchQueriesTable)
      .set({ clickedKind, clickedRank, clickedSlug })
      .where(eq(searchQueriesTable.id, searchId));
  } catch (err) {
    req.log?.warn({ err }, "search click telemetry update failed");
  }
  res.json({ ok: true });
});

// GET /api/cms/search-kind-boosts — admin read of the per-kind ranking
// boosts editors can tune from the search-analytics page. Returns the
// effective values (defaults merged with any stored overrides) so the
// UI can render a complete form even before anything has been saved.
router.get(
  "/cms/search-kind-boosts",
  requireCapability("site.manage"),
  async (_req, res) => {
    const boosts = await loadKindBoosts();
    res.json({ boosts, defaults: DEFAULT_KIND_BOOSTS });
  },
);

// PUT /api/cms/search-kind-boosts — accepts a partial map of kind→number
// (positive, finite). Unknown kinds are rejected; missing kinds keep
// their existing value. Stored as jsonb on `site_settings.search_kind_boosts`.
const KindBoostsBody = z.object({
  boosts: z.record(z.enum(SEARCH_KINDS), z.number().positive().finite().max(10)),
});
router.put(
  "/cms/search-kind-boosts",
  requireCapability("site.manage"),
  async (req, res) => {
    const parsed = KindBoostsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const incoming = parsed.data.boosts as Partial<Record<SearchKind, number>>;
    const current = await loadKindBoosts();
    const merged: Record<SearchKind, number> = { ...current };
    for (const k of SEARCH_KINDS) {
      const v = incoming[k];
      if (typeof v === "number") merged[k] = Number(v);
    }
    await db
      .insert(siteSettingsTable)
      .values({ id: 1, requireCookieConsent: false, searchKindBoosts: merged })
      .onConflictDoUpdate({
        target: siteSettingsTable.id,
        set: { searchKindBoosts: merged },
      });
    res.json({ boosts: merged });
  },
);

// GET /api/cms/search-analytics?days=30
//
// Powers the admin "search analytics" page: top zero-result queries, top
// queries overall, click-through rate, and top clicked kinds. Read-only;
// gated on `site.manage` which is the same capability the rest of the
// admin insights surfaces use.
const AnalyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});
router.get(
  "/cms/search-analytics",
  requireCapability("site.manage"),
  async (req, res) => {
    const parsed = AnalyticsQuery.safeParse(req.query ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const { days } = parsed.data;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const recent = and(gte(searchQueriesTable.createdAt, since));

    const [zeroRows, topRows, totalsRow, kindRows] = await Promise.all([
      db
        .select({
          query: searchQueriesTable.queryNormalized,
          c: count(),
        })
        .from(searchQueriesTable)
        .where(and(recent, eq(searchQueriesTable.resultCount, 0)))
        .groupBy(searchQueriesTable.queryNormalized)
        .orderBy(desc(count()))
        .limit(50),
      db
        .select({
          query: searchQueriesTable.queryNormalized,
          c: count(),
        })
        .from(searchQueriesTable)
        .where(recent)
        .groupBy(searchQueriesTable.queryNormalized)
        .orderBy(desc(count()))
        .limit(50),
      db
        .select({
          total: count(),
          clicked: sql<number>`COUNT(*) FILTER (WHERE ${searchQueriesTable.clickedKind} IS NOT NULL)`,
          zero: sql<number>`COUNT(*) FILTER (WHERE ${searchQueriesTable.resultCount} = 0)`,
        })
        .from(searchQueriesTable)
        .where(recent),
      db
        .select({
          kind: searchQueriesTable.clickedKind,
          c: count(),
        })
        .from(searchQueriesTable)
        .where(and(recent, sql`${searchQueriesTable.clickedKind} IS NOT NULL`))
        .groupBy(searchQueriesTable.clickedKind)
        .orderBy(desc(count()))
        .limit(20),
    ]);

    const totals = totalsRow[0] ?? { total: 0, clicked: 0, zero: 0 };
    const total = Number(totals.total) || 0;
    const clicked = Number(totals.clicked) || 0;
    const zero = Number(totals.zero) || 0;

    res.json({
      days,
      totals: {
        total,
        clicked,
        zero,
        clickThroughRate: total > 0 ? clicked / total : 0,
        zeroResultRate: total > 0 ? zero / total : 0,
      },
      zeroResultQueries: zeroRows.map((r) => ({ query: r.query, count: Number(r.c) })),
      topQueries: topRows.map((r) => ({ query: r.query, count: Number(r.c) })),
      topClickedKinds: kindRows.map((r) => ({
        kind: r.kind,
        count: Number(r.c),
      })),
    });
  },
);

export default router;
