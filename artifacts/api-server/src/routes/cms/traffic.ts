import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql, countDistinct } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
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
      pageviews: sql<number>`count(*)::int`,
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

router.get("/cms/traffic/timeseries", ...adminOnly, async (req, res) => {
  const f = parseFilters(req, res);
  if (!f) return;
  const window = resolveWindow(f);
  const pvWhere = pageviewFilters(f, window);

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${trafficPageviewsTable.viewedAt}), 'YYYY-MM-DD')`,
      pageviews: sql<number>`count(*)::int`,
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
      pageviews: sql<number>`count(*)::int`,
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
    .orderBy(desc(sql`count(*)`))
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

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.viewedAt, r.path, r.pageType, r.title,
      r.timeOnPageMs, r.scrollDepthPct,
      r.sessionHash, r.deviceType, r.browserName, r.osName,
      r.country, r.region, r.city,
      r.trafficSource, r.referrerHost,
      r.utmSource, r.utmMedium, r.utmCampaign,
      r.isBot, r.botName, r.botCategory,
    ].map(escape).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="traffic-${stamp}.csv"`);
  res.send(lines.join("\r\n"));
});

export default router;
