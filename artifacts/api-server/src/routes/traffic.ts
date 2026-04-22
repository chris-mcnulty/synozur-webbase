import { Router, type IRouter } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sql } from "drizzle-orm";
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
} from "@workspace/db";
import {
  classifyPageType,
  classifySource,
  clientIpFromRequest,
  countryFromRequest,
  hostFromReferrer,
  ipHash,
  parseUa,
  sessionKey,
  todayBucket,
} from "../lib/traffic";

const router: IRouter = Router();

const CollectBody = z.object({
  path: z.string().min(1).max(2048),
  title: z.string().max(512).optional().nullable(),
  referrer: z.string().max(2048).optional().nullable(),
  // Optional extras, populated by the client beacon on unload.
  timeOnPageMs: z.number().int().min(0).max(1000 * 60 * 60 * 6).optional().nullable(),
  scrollDepthPct: z.number().int().min(0).max(100).optional().nullable(),
  // If set, update the existing pageview rather than inserting a new one.
  pageviewId: z.string().uuid().optional().nullable(),
});

function ipKey(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xff = Array.isArray(req.headers["x-forwarded-for"])
    ? (req.headers["x-forwarded-for"] as string[])[0]
    : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = xff || req.ip || "0.0.0.0";
  return ipKeyGenerator(ip);
}

const collectLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `t:c:${ipKey(req)}`,
  handler: (_req, res) => {
    res.status(202).json({ ok: true });
  },
});

function selfHostOf(req: import("express").Request): string | null {
  const h = req.headers.host as string | undefined;
  if (!h) return null;
  return h.split(":")[0] ?? null;
}

function shouldSkipTrafficPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/sign-in" ||
    pathname === "/sign-up"
  );
}

router.post("/traffic/collect", collectLimiter, async (req, res) => {
  const parsed = CollectBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Beacon-friendly: never reflect errors back.
    res.status(202).json({ ok: true });
    return;
  }

  try {
    const pathname = normalizePath(parsed.data.path);
    if (!pathname) {
      res.status(202).json({ ok: true });
      return;
    }
    if (shouldSkipTrafficPath(pathname)) {
      res.status(202).json({ ok: true });
      return;
    }

    // Update path for an existing pageview (unload beacon).
    if (parsed.data.pageviewId && (parsed.data.timeOnPageMs != null || parsed.data.scrollDepthPct != null)) {
      const requestIpHash = ipHash(clientIpFromRequest(req) || "0.0.0.0");
      await db
        .update(trafficPageviewsTable)
        .set({
          timeOnPageMs: parsed.data.timeOnPageMs ?? undefined,
          scrollDepthPct: parsed.data.scrollDepthPct ?? undefined,
        })
        .where(sql`
          ${trafficPageviewsTable.id} = ${parsed.data.pageviewId}
          and exists (
            select 1
            from ${trafficSessionsTable}
            where ${trafficSessionsTable.id} = ${trafficPageviewsTable.sessionId}
              and ${trafficSessionsTable.ipHash} = ${requestIpHash}
          )
        `);
      res.status(202).json({ ok: true });
      return;
    }

    const pv = await recordPageview({
      req,
      pathname,
      title: parsed.data.title ?? null,
      referrer: parsed.data.referrer ?? null,
      queryString: extractQueryString(parsed.data.path),
    });
    res.status(202).json({ ok: true, pageviewId: pv?.id ?? null });
  } catch (err) {
    req.log.warn({ err }, "traffic.collect failed");
    res.status(202).json({ ok: true });
  }
});

function normalizePath(raw: string): string | null {
  try {
    // Accept either absolute URL or bare path.
    const isAbsolute = /^https?:\/\//i.test(raw);
    const u = isAbsolute ? new URL(raw) : new URL(raw, "http://local");
    const p = u.pathname || "/";
    return p.slice(0, 2048);
  } catch {
    return null;
  }
}

function extractQueryString(raw: string): URLSearchParams | null {
  try {
    const isAbsolute = /^https?:\/\//i.test(raw);
    const u = isAbsolute ? new URL(raw) : new URL(raw, "http://local");
    return u.searchParams;
  } catch {
    return null;
  }
}

interface RecordPageviewArgs {
  req: import("express").Request;
  pathname: string;
  title: string | null;
  referrer: string | null;
  queryString: URLSearchParams | null;
}

/**
 * Core pageview ingestion. Shared between the public collect endpoint and
 * the crawler middleware. Upserts a session row (one per IP+UA per UTC day)
 * and always inserts one pageview row.
 *
 * Returns the inserted pageview id so the SPA can later patch in
 * time-on-page / scroll depth via the unload beacon.
 */
export async function recordPageview(args: RecordPageviewArgs): Promise<{ id: string } | null> {
  const { req, pathname, title, referrer, queryString } = args;
  const ua = (req.headers["user-agent"] as string | undefined) ?? "";
  const uaFacts = parseUa(ua);
  const ip = clientIpFromRequest(req);
  const selfHost = selfHostOf(req);
  const geo = countryFromRequest(req);
  const sourceCls = classifySource({
    referrerUrl: referrer,
    selfHost,
    landingQuery: queryString,
    isBotCategory: uaFacts.botCategory,
  });

  const bucket = todayBucket();
  const sessionHash = sessionKey(ip, ua, bucket);

  // Upsert session. On conflict we bump `lastSeenAt` + pageview_count,
  // but leave the first-touch attribution (referrer/source/utm/landing) alone.
  const inserted = await db
    .insert(trafficSessionsTable)
    .values({
      sessionHash,
      userAgent: ua.slice(0, 1024) || null,
      browserName: uaFacts.browserName,
      browserVersion: uaFacts.browserVersion,
      osName: uaFacts.osName,
      deviceType: uaFacts.deviceType,
      ipHash: ipHash(ip),
      country: geo.country,
      region: geo.region,
      city: geo.city,
      landingPath: pathname,
      referrerUrl: sourceCls.referrerUrl?.slice(0, 2048) ?? null,
      referrerHost: sourceCls.referrerHost,
      trafficSource: sourceCls.source,
      utmSource: sourceCls.utmSource,
      utmMedium: sourceCls.utmMedium,
      utmCampaign: sourceCls.utmCampaign,
      utmTerm: sourceCls.utmTerm,
      utmContent: sourceCls.utmContent,
      isBot: uaFacts.isBot,
      botCategory: uaFacts.botCategory,
      botName: uaFacts.botName,
      pageviewCount: 1,
    })
    .onConflictDoUpdate({
      target: trafficSessionsTable.sessionHash,
      set: {
        lastSeenAt: new Date(),
        pageviewCount: sql`${trafficSessionsTable.pageviewCount} + 1`,
      },
    })
    .returning({ id: trafficSessionsTable.id });

  const sessionId = inserted[0]?.id;
  if (!sessionId) return null;

  const [pv] = await db
    .insert(trafficPageviewsTable)
    .values({
      sessionId,
      path: pathname,
      pageType: classifyPageType(pathname),
      title: title?.slice(0, 512) ?? null,
      referrerUrl: referrer?.slice(0, 2048) ?? null,
      referrerHost: hostFromReferrer(referrer, selfHost),
    })
    .returning({ id: trafficPageviewsTable.id });

  return pv ?? null;
}

export default router;
