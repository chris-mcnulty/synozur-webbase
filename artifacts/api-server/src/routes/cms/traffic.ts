import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, sql, countDistinct } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
  trafficEventsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();

// All admin traffic endpoints require an editor/admin role.
const adminOnly = [requireAuth, requireRole("admin", "editor")];

const Filters = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  // Default window is the last 30 days if neither from/to provided.
  days: z.coerce.number().int().min(1).max(365).default(30),
  pageType: z.string().max(64).optional(),
  path: z.string().max(512).optional(),
  country: z.string().length(2).optional(),
  device: z.enum(["desktop", "mobile", "tablet", "bot"]).optional(),
  browser: z.string().max(64).optional(),
  source: z.enum(["direct", "organic", "ai", "referral", "social", "paid", "internal"]).optional(),
  includeBots: z
    .enum(["true", "false", "only"])
    .optional()
    .default("false"),
  // Property filter (#228). Multi-select list of `traffic_properties.slug`
  // values, comma-separated in the query string. Default is the built-in
  // `synozur` property — admins must explicitly opt in to legacy / external
  // properties. The sentinel value `all` (alone) skips the filter.
  // Accepts repeated `propertySlugs=` params or one CSV `propertySlugs=a,b`.
  propertySlugs: z
    .preprocess(
      (v) => {
        if (v === undefined || v === null) return undefined;
        if (Array.isArray(v)) return v.flatMap((x) => String(x).split(","));
        return String(v).split(",");
      },
      z.array(z.string().min(1).max(64)).optional(),
    ),
});

type ParsedFilters = z.infer<typeof Filters>;

interface Window {
  from: Date;
  to: Date;
}

function resolveWindow(f: ParsedFilters): Window {
  const to = f.to ? new Date(f.to) : new Date();
  let from: Date;
  if (f.from) {
    from = new Date(f.from);
  } else {
    from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - (f.days - 1));
  }
  return { from, to };
}

function resolvePropertySlugs(f: ParsedFilters): string[] | null {
  // Default = built-in synozur property only. `['all']` (sentinel) skips
  // the filter entirely so cross-property comparison reports work.
  const slugs = f.propertySlugs && f.propertySlugs.length > 0 ? f.propertySlugs : ["synozur"];
  if (slugs.length === 1 && slugs[0] === "all") return null;
  return Array.from(new Set(slugs));
}

function applyPropertyPageview(f: ParsedFilters, where: SQL[]): void {
  const slugs = resolvePropertySlugs(f);
  if (!slugs) return;
  where.push(inArray(trafficPageviewsTable.sourceSystem, slugs));
}

function applyPropertySession(f: ParsedFilters, where: SQL[]): void {
  const slugs = resolvePropertySlugs(f);
  if (!slugs) return;
  where.push(inArray(trafficSessionsTable.sourceSystem, slugs));
}

/** Build the WHERE clause for joined pageview+session queries. */
function pageviewFilters(f: ParsedFilters, window: Window): SQL[] {
  const where: SQL[] = [
    gte(trafficPageviewsTable.viewedAt, window.from),
    lte(trafficPageviewsTable.viewedAt, window.to),
  ];
  if (f.pageType) where.push(eq(trafficPageviewsTable.pageType, f.pageType));
  if (f.path) where.push(eq(trafficPageviewsTable.path, f.path));
  if (f.country) where.push(eq(trafficSessionsTable.country, f.country.toUpperCase()));
  if (f.device) where.push(eq(trafficSessionsTable.deviceType, f.device));
  if (f.browser) where.push(eq(trafficSessionsTable.browserName, f.browser));
  if (f.source) where.push(eq(trafficSessionsTable.trafficSource, f.source));
  if (f.includeBots === "false") where.push(eq(trafficSessionsTable.isBot, false));
  if (f.includeBots === "only") where.push(eq(trafficSessionsTable.isBot, true));
  applyPropertyPageview(f, where);
  return where;
}

function sessionFilters(f: ParsedFilters, window: Window): SQL[] {
  // Sessions are attributed at first-touch — use firstSeenAt for the window.
  const where: SQL[] = [
    gte(trafficSessionsTable.firstSeenAt, window.from),
    lte(trafficSessionsTable.firstSeenAt, window.to),
  ];
  if (f.country) where.push(eq(trafficSessionsTable.country, f.country.toUpperCase()));
  if (f.device) where.push(eq(trafficSessionsTable.deviceType, f.device));
  if (f.browser) where.push(eq(trafficSessionsTable.browserName, f.browser));
  if (f.source) where.push(eq(trafficSessionsTable.trafficSource, f.source));
  if (f.includeBots === "false") where.push(eq(trafficSessionsTable.isBot, false));
  if (f.includeBots === "only") where.push(eq(trafficSessionsTable.isBot, true));
  applyPropertySession(f, where);
  return where;
}

function parseFilters(req: import("express").Request, res: import("express").Response): ParsedFilters | null {
  const parsed = Filters.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}

router.get("/cms/traffic/overview", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);
  const sessWhere = sessionFilters(f, window);

  const [pvTotalsRow] = await db
    .select({
      // Use sum(pageviewCount) so legacy-imported rows (which carry an
      // aggregated count > 1 per row) and native rows (always count = 1)
      // both report correct pageview totals.
      pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
      sessions: countDistinct(trafficPageviewsTable.sessionId),
    })
    .from(trafficPageviewsTable)
    .innerJoin(
      trafficSessionsTable,
      eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
    )
    .where(and(...pvWhere));

  const [sessTotalsRow] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      uniqueVisitors: countDistinct(trafficSessionsTable.ipHash),
      countries: sql<number>`count(distinct ${trafficSessionsTable.country})::int`,
      bots: sql<number>`sum(case when ${trafficSessionsTable.isBot} then 1 else 0 end)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere));

  res.json({
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    totals: {
      pageviews: pvTotalsRow?.pageviews ?? 0,
      sessions: sessTotalsRow?.sessions ?? 0,
      uniqueVisitors: sessTotalsRow?.uniqueVisitors ?? 0,
      countries: sessTotalsRow?.countries ?? 0,
      bots: sessTotalsRow?.bots ?? 0,
      humanSessions: Math.max(0, (sessTotalsRow?.sessions ?? 0) - (sessTotalsRow?.bots ?? 0)),
      activeSessions: pvTotalsRow?.sessions ?? 0,
    },
  });
});

// #228 — Per-property breakdown for the dashboard. Returns one row per
// source_system within the active window so multi-property selections can
// render side-by-side property cards. Honors all the standard filters
// EXCEPT propertySlugs (the breakdown is itself a property axis).
router.get("/cms/traffic/by-property", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);

  // Honor every non-property filter via the shared sessionFilters() so the
  // breakdown stays consistent with the overview / pages / sources cards.
  // Path and pageType, however, live on pageviews — apply those by joining.
  const sessWhere = sessionFilters(f, window);
  const needsPageviewJoin = Boolean(f.path) || Boolean(f.pageType);

  let rows;
  if (needsPageviewJoin) {
    const pvWhere: SQL[] = [];
    if (f.path) pvWhere.push(eq(trafficPageviewsTable.path, f.path));
    if (f.pageType) pvWhere.push(eq(trafficPageviewsTable.pageType, f.pageType));
    rows = await db
      .selectDistinct({
        slug: trafficSessionsTable.sourceSystem,
        sessions: countDistinct(trafficSessionsTable.id),
        uniqueVisitors: countDistinct(trafficSessionsTable.ipHash),
        pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
      })
      .from(trafficSessionsTable)
      .innerJoin(
        trafficPageviewsTable,
        eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
      )
      .where(and(...sessWhere, ...pvWhere))
      .groupBy(trafficSessionsTable.sourceSystem)
      .orderBy(desc(countDistinct(trafficSessionsTable.id)));
  } else {
    rows = await db
      .select({
        slug: trafficSessionsTable.sourceSystem,
        sessions: sql<number>`count(*)::int`,
        uniqueVisitors: countDistinct(trafficSessionsTable.ipHash),
        pageviews: sql<number>`coalesce(sum(${trafficSessionsTable.pageviewCount}), 0)::int`,
      })
      .from(trafficSessionsTable)
      .where(and(...sessWhere))
      .groupBy(trafficSessionsTable.sourceSystem)
      .orderBy(desc(sql`count(*)`));
  }

  res.json({
    items: rows.map((r) => ({
      slug: r.slug,
      sessions: r.sessions,
      uniqueVisitors: r.uniqueVisitors,
      pageviews: r.pageviews,
    })),
  });
});

router.get("/cms/traffic/timeseries", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${trafficPageviewsTable.viewedAt}), 'YYYY-MM-DD')`,
      pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
      sessions: countDistinct(trafficPageviewsTable.sessionId),
    })
    .from(trafficPageviewsTable)
    .innerJoin(
      trafficSessionsTable,
      eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
    )
    .where(and(...pvWhere))
    .groupBy(sql`date_trunc('day', ${trafficPageviewsTable.viewedAt})`)
    .orderBy(sql`date_trunc('day', ${trafficPageviewsTable.viewedAt})`);

  res.json({
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    series: rows.map((r) => ({ day: r.day, pageviews: r.pageviews, sessions: r.sessions })),
  });
});

router.get("/cms/traffic/pages", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);

  const rows = await db
    .select({
      path: trafficPageviewsTable.path,
      pageType: trafficPageviewsTable.pageType,
      title: sql<string | null>`max(${trafficPageviewsTable.title})`,
      pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
      sessions: countDistinct(trafficPageviewsTable.sessionId),
      avgTimeOnPageMs: sql<number | null>`avg(${trafficPageviewsTable.timeOnPageMs})::int`,
    })
    .from(trafficPageviewsTable)
    .innerJoin(
      trafficSessionsTable,
      eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
    )
    .where(and(...pvWhere))
    .groupBy(trafficPageviewsTable.path, trafficPageviewsTable.pageType)
    .orderBy(desc(sql`sum(${trafficPageviewsTable.pageviewCount})`))
    .limit(50);

  res.json({ items: rows });
});

router.get("/cms/traffic/sources", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const sessWhere = sessionFilters(f, window);

  const bySource = await db
    .select({
      source: sql<string>`coalesce(${trafficSessionsTable.trafficSource}, 'unknown')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.trafficSource)
    .orderBy(desc(sql`count(*)`));

  const byReferrer = await db
    .select({
      host: sql<string>`coalesce(${trafficSessionsTable.referrerHost}, '(direct)')`,
      source: sql<string | null>`${trafficSessionsTable.trafficSource}`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.referrerHost, trafficSessionsTable.trafficSource)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  const byUtmCampaign = await db
    .select({
      campaign: sql<string>`${trafficSessionsTable.utmCampaign}`,
      source: sql<string | null>`${trafficSessionsTable.utmSource}`,
      medium: sql<string | null>`${trafficSessionsTable.utmMedium}`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere, sql`${trafficSessionsTable.utmCampaign} is not null`))
    .groupBy(
      trafficSessionsTable.utmCampaign,
      trafficSessionsTable.utmSource,
      trafficSessionsTable.utmMedium,
    )
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  res.json({ bySource, byReferrer, byUtmCampaign });
});

router.get("/cms/traffic/devices", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const sessWhere = sessionFilters(f, window);

  const byDevice = await db
    .select({
      deviceType: sql<string>`coalesce(${trafficSessionsTable.deviceType}, 'unknown')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.deviceType)
    .orderBy(desc(sql`count(*)`));

  const byBrowser = await db
    .select({
      browser: sql<string>`coalesce(${trafficSessionsTable.browserName}, 'unknown')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.browserName)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  const byOs = await db
    .select({
      os: sql<string>`coalesce(${trafficSessionsTable.osName}, 'unknown')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.osName)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  res.json({ byDevice, byBrowser, byOs });
});

router.get("/cms/traffic/countries", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const sessWhere = sessionFilters(f, window);

  const rows = await db
    .select({
      country: sql<string>`coalesce(${trafficSessionsTable.country}, 'unknown')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.country)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  res.json({ items: rows });
});

router.get("/cms/traffic/ai-crawlers", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  // Override bot filter for this endpoint — we always want bots here, not humans.
  const sessWhere: SQL[] = [
    gte(trafficSessionsTable.firstSeenAt, window.from),
    lte(trafficSessionsTable.firstSeenAt, window.to),
    eq(trafficSessionsTable.isBot, true),
  ];
  applyPropertySession(f, sessWhere);

  const byBot = await db
    .select({
      botName: sql<string>`coalesce(${trafficSessionsTable.botName}, 'unknown')`,
      botCategory: sql<string>`coalesce(${trafficSessionsTable.botCategory}, 'other')`,
      sessions: sql<number>`count(*)::int`,
      pageviews: sql<number>`coalesce(sum(${trafficSessionsTable.pageviewCount}), 0)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .groupBy(trafficSessionsTable.botName, trafficSessionsTable.botCategory)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  // AI-platform referrer hits (humans arriving FROM ChatGPT, Gemini, etc).
  const aiReferredHumanWhere: SQL[] = [
    gte(trafficSessionsTable.firstSeenAt, window.from),
    lte(trafficSessionsTable.firstSeenAt, window.to),
    eq(trafficSessionsTable.isBot, false),
    eq(trafficSessionsTable.trafficSource, "ai"),
  ];
  applyPropertySession(f, aiReferredHumanWhere);
  const fromAiPlatforms = await db
    .select({
      host: sql<string>`coalesce(${trafficSessionsTable.referrerHost}, '(direct)')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...aiReferredHumanWhere))
    .groupBy(trafficSessionsTable.referrerHost)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  res.json({ byBot, fromAiPlatforms });
});

router.get("/cms/traffic/utms", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const sessWhere = sessionFilters(f, window);
  const taggedWhere = [
    ...sessWhere,
    sql`(${trafficSessionsTable.utmSource} is not null
         or ${trafficSessionsTable.utmMedium} is not null
         or ${trafficSessionsTable.utmCampaign} is not null)`,
  ];

  const bySource = await db
    .select({
      value: sql<string>`coalesce(${trafficSessionsTable.utmSource}, '(none)')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...taggedWhere))
    .groupBy(trafficSessionsTable.utmSource)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  const byMedium = await db
    .select({
      value: sql<string>`coalesce(${trafficSessionsTable.utmMedium}, '(none)')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...taggedWhere))
    .groupBy(trafficSessionsTable.utmMedium)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  const byCampaign = await db
    .select({
      value: sql<string>`coalesce(${trafficSessionsTable.utmCampaign}, '(none)')`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(trafficSessionsTable)
    .where(and(...taggedWhere))
    .groupBy(trafficSessionsTable.utmCampaign)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  res.json({ bySource, byMedium, byCampaign });
});

router.get("/cms/traffic/events", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);

  const evWhere: SQL[] = [
    gte(trafficEventsTable.occurredAt, window.from),
    lte(trafficEventsTable.occurredAt, window.to),
  ];
  if (f.includeBots === "false") evWhere.push(eq(trafficSessionsTable.isBot, false));
  if (f.includeBots === "only") evWhere.push(eq(trafficSessionsTable.isBot, true));
  if (f.country) evWhere.push(eq(trafficSessionsTable.country, f.country.toUpperCase()));
  if (f.source) evWhere.push(eq(trafficSessionsTable.trafficSource, f.source));

  const byName = await db
    .select({
      eventName: trafficEventsTable.eventName,
      total: sql<number>`count(*)::int`,
      sessions: countDistinct(trafficEventsTable.sessionId),
    })
    .from(trafficEventsTable)
    .innerJoin(trafficSessionsTable, eq(trafficEventsTable.sessionId, trafficSessionsTable.id))
    .where(and(...evWhere))
    .groupBy(trafficEventsTable.eventName)
    .orderBy(desc(sql`count(*)`))
    .limit(50);

  const recent = await db
    .select({
      occurredAt: trafficEventsTable.occurredAt,
      eventName: trafficEventsTable.eventName,
      path: trafficEventsTable.path,
      properties: trafficEventsTable.properties,
    })
    .from(trafficEventsTable)
    .innerJoin(trafficSessionsTable, eq(trafficEventsTable.sessionId, trafficSessionsTable.id))
    .where(and(...evWhere))
    .orderBy(desc(trafficEventsTable.occurredAt))
    .limit(50);

  res.json({ byName, recent });
});

router.get("/cms/analytics/overview.csv", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${trafficPageviewsTable.viewedAt}), 'YYYY-MM-DD')`,
      pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
      sessions: countDistinct(trafficPageviewsTable.sessionId),
    })
    .from(trafficPageviewsTable)
    .innerJoin(
      trafficSessionsTable,
      eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
    )
    .where(and(...pvWhere))
    .groupBy(sql`date_trunc('day', ${trafficPageviewsTable.viewedAt})`)
    .orderBy(sql`date_trunc('day', ${trafficPageviewsTable.viewedAt})`);

  sendCsv(res, "analytics-overview", ["day", "pageviews", "sessions"], rows, (r) => [
    r.day, r.pageviews, r.sessions,
  ]);
});

router.get("/cms/analytics/sessions.csv", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const sessWhere = sessionFilters(f, window);

  const rows = await db
    .select({
      firstSeenAt: trafficSessionsTable.firstSeenAt,
      lastSeenAt: trafficSessionsTable.lastSeenAt,
      sessionHash: trafficSessionsTable.sessionHash,
      pageviewCount: trafficSessionsTable.pageviewCount,
      deviceType: trafficSessionsTable.deviceType,
      browserName: trafficSessionsTable.browserName,
      osName: trafficSessionsTable.osName,
      country: trafficSessionsTable.country,
      region: trafficSessionsTable.region,
      city: trafficSessionsTable.city,
      landingPath: trafficSessionsTable.landingPath,
      trafficSource: trafficSessionsTable.trafficSource,
      referrerHost: trafficSessionsTable.referrerHost,
      utmSource: trafficSessionsTable.utmSource,
      utmMedium: trafficSessionsTable.utmMedium,
      utmCampaign: trafficSessionsTable.utmCampaign,
      utmTerm: trafficSessionsTable.utmTerm,
      utmContent: trafficSessionsTable.utmContent,
      isBot: trafficSessionsTable.isBot,
      botName: trafficSessionsTable.botName,
      botCategory: trafficSessionsTable.botCategory,
    })
    .from(trafficSessionsTable)
    .where(and(...sessWhere))
    .orderBy(desc(trafficSessionsTable.firstSeenAt))
    .limit(50_000);

  const headers = [
    "firstSeenAt", "lastSeenAt", "sessionHash", "pageviewCount",
    "deviceType", "browserName", "osName",
    "country", "region", "city",
    "landingPath", "trafficSource", "referrerHost",
    "utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent",
    "isBot", "botName", "botCategory",
  ];
  sendCsv(res, "analytics-sessions", headers, rows, (r) => [
    r.firstSeenAt, r.lastSeenAt, r.sessionHash, r.pageviewCount,
    r.deviceType, r.browserName, r.osName,
    r.country, r.region, r.city,
    r.landingPath, r.trafficSource, r.referrerHost,
    r.utmSource, r.utmMedium, r.utmCampaign, r.utmTerm, r.utmContent,
    r.isBot, r.botName, r.botCategory,
  ]);
});

router.get("/cms/traffic/export.csv", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);

  const rows = await db
    .select({
      viewedAt: trafficPageviewsTable.viewedAt,
      path: trafficPageviewsTable.path,
      pageType: trafficPageviewsTable.pageType,
      title: trafficPageviewsTable.title,
      timeOnPageMs: trafficPageviewsTable.timeOnPageMs,
      scrollDepthPct: trafficPageviewsTable.scrollDepthPct,
      sessionHash: trafficSessionsTable.sessionHash,
      deviceType: trafficSessionsTable.deviceType,
      browserName: trafficSessionsTable.browserName,
      osName: trafficSessionsTable.osName,
      country: trafficSessionsTable.country,
      region: trafficSessionsTable.region,
      city: trafficSessionsTable.city,
      trafficSource: trafficSessionsTable.trafficSource,
      referrerHost: trafficSessionsTable.referrerHost,
      utmSource: trafficSessionsTable.utmSource,
      utmMedium: trafficSessionsTable.utmMedium,
      utmCampaign: trafficSessionsTable.utmCampaign,
      isBot: trafficSessionsTable.isBot,
      botName: trafficSessionsTable.botName,
      botCategory: trafficSessionsTable.botCategory,
    })
    .from(trafficPageviewsTable)
    .innerJoin(
      trafficSessionsTable,
      eq(trafficPageviewsTable.sessionId, trafficSessionsTable.id),
    )
    .where(and(...pvWhere))
    .orderBy(desc(trafficPageviewsTable.viewedAt))
    .limit(50_000);

  const headers = [
    "viewedAt", "path", "pageType", "title",
    "timeOnPageMs", "scrollDepthPct",
    "sessionHash", "deviceType", "browserName", "osName",
    "country", "region", "city",
    "trafficSource", "referrerHost",
    "utmSource", "utmMedium", "utmCampaign",
    "isBot", "botName", "botCategory",
  ];
  sendCsv(res, "traffic", headers, rows, (r) => [
    r.viewedAt, r.path, r.pageType, r.title,
    r.timeOnPageMs, r.scrollDepthPct,
    r.sessionHash, r.deviceType, r.browserName, r.osName,
    r.country, r.region, r.city,
    r.trafficSource, r.referrerHost,
    r.utmSource, r.utmMedium, r.utmCampaign,
    r.isBot, r.botName, r.botCategory,
  ]);
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  const needsFormulaHardening = /^[=+\-@]/.test(s.trimStart());
  const safe = needsFormulaHardening ? `'${s}` : s;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function sendCsv<T>(
  res: import("express").Response,
  filenamePrefix: string,
  headers: string[],
  rows: T[],
  mapRow: (r: T) => unknown[],
): void {
  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    lines.push(mapRow(r).map(csvEscape).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filenamePrefix}-${stamp}.csv"`);
  res.send(lines.join("\r\n"));
}

export default router;
