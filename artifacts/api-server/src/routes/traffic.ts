import { Router, type IRouter } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
  trafficEventsTable,
  trafficPropertiesTable,
  notFoundLogsTable,
} from "@workspace/db";
import {
  ingestPageviewBatch,
  ingestSessionBatch,
  normalizeIngestRow,
  normalizeIngestSessionRow,
  type IngestPageviewRow,
  type IngestSessionRow,
} from "../lib/trafficIngest";
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
import { normalizePath as normalizeRedirectPath } from "../lib/wixRedirects";

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
  // Client-captured UTMs (server also harvests from path querystring).
  utmSource: z.string().max(120).optional().nullable(),
  utmMedium: z.string().max(120).optional().nullable(),
  utmCampaign: z.string().max(120).optional().nullable(),
  utmTerm: z.string().max(120).optional().nullable(),
  utmContent: z.string().max(120).optional().nullable(),
});

const EventBody = z.object({
  eventName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_.-]+$/, "eventName must be alphanumeric, dot, dash, or underscore"),
  path: z.string().min(1).max(2048),
  properties: z.record(z.unknown()).optional().nullable(),
});

const NotFoundBody = z.object({
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).optional().nullable(),
  // #163: visitor-supplied context from the "report this missing page" form.
  // Editorial reviews these in the admin 404 log.
  note: z.string().max(500).optional().nullable(),
  reported: z.boolean().optional(),
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

const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `t:e:${ipKey(req)}`,
  handler: (_req, res) => {
    res.status(202).json({ ok: true });
  },
});

const notFoundLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `t:nf:${ipKey(req)}`,
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
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up")
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

    const clientUtms = {
      utmSource: parsed.data.utmSource ?? null,
      utmMedium: parsed.data.utmMedium ?? null,
      utmCampaign: parsed.data.utmCampaign ?? null,
      utmTerm: parsed.data.utmTerm ?? null,
      utmContent: parsed.data.utmContent ?? null,
    };
    const pv = await recordPageview({
      req,
      pathname,
      title: parsed.data.title ?? null,
      referrer: parsed.data.referrer ?? null,
      queryString: extractQueryString(parsed.data.path),
      clientUtms,
    });
    res.status(202).json({ ok: true, pageviewId: pv?.id ?? null });
  } catch (err) {
    req.log.warn({ err }, "traffic.collect failed");
    res.status(202).json({ ok: true });
  }
});

router.post("/traffic/event", eventLimiter, async (req, res) => {
  const parsed = EventBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(202).json({ ok: true });
    return;
  }

  try {
    const pathname = normalizePath(parsed.data.path);
    if (!pathname || shouldSkipTrafficPath(pathname)) {
      res.status(202).json({ ok: true });
      return;
    }

    // Re-use the upsert path so the event attaches to the caller's session
    // (one session per IP+UA+day) without requiring a pageview to exist.
    const ua = (req.headers["user-agent"] as string | undefined) ?? "";
    const uaFacts = parseUa(ua);
    const ip = clientIpFromRequest(req);
    const selfHost = selfHostOf(req);
    const geo = countryFromRequest(req);
    const sourceCls = classifySource({
      referrerUrl: null,
      selfHost,
      landingQuery: extractQueryString(parsed.data.path),
      isBotCategory: uaFacts.botCategory,
    });
    const bucket = todayBucket();
    const sessionHash = sessionKey(ip, ua, bucket);

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
        trafficSource: sourceCls.source,
        utmSource: sourceCls.utmSource,
        utmMedium: sourceCls.utmMedium,
        utmCampaign: sourceCls.utmCampaign,
        utmTerm: sourceCls.utmTerm,
        utmContent: sourceCls.utmContent,
        isBot: uaFacts.isBot,
        botCategory: uaFacts.botCategory,
        botName: uaFacts.botName,
        pageviewCount: 0,
      })
      .onConflictDoUpdate({
        target: trafficSessionsTable.sessionHash,
        set: { lastSeenAt: new Date() },
      })
      .returning({ id: trafficSessionsTable.id });

    const sessionId = inserted[0]?.id;
    if (!sessionId) {
      res.status(202).json({ ok: true });
      return;
    }

    // Cap properties payload — keep the admin view honest and prevent blob abuse.
    const props = parsed.data.properties ?? null;
    const serializedProps = props ? JSON.stringify(props) : null;
    const safeProps =
      serializedProps && serializedProps.length <= 4096
        ? JSON.parse(serializedProps)
        : null;

    await db.insert(trafficEventsTable).values({
      sessionId,
      path: pathname,
      eventName: parsed.data.eventName.slice(0, 80),
      properties: safeProps,
    });

    res.status(202).json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "traffic.event failed");
    res.status(202).json({ ok: true });
  }
});

/**
 * Records a 404 hit so admins can later map frequently-missed paths to a
 * Wix redirect. Beacon-friendly: always returns 202 even on validation
 * errors so the SPA never has to handle a failure path.
 */
router.post("/traffic/not-found", notFoundLimiter, async (req, res) => {
  const parsed = NotFoundBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(202).json({ ok: true });
    return;
  }

  try {
    const pathname = normalizePath(parsed.data.path);
    if (!pathname || shouldSkipTrafficPath(pathname)) {
      res.status(202).json({ ok: true });
      return;
    }
    // Don't log /api/* — those are handled by the API server, not the SPA.
    if (pathname.startsWith("/api/") || pathname === "/api") {
      res.status(202).json({ ok: true });
      return;
    }

    const normalized = normalizeRedirectPath(pathname);
    const referrer = parsed.data.referrer?.slice(0, 2048) ?? null;
    const ua =
      ((req.headers["user-agent"] as string | undefined) ?? "").slice(0, 1024) ||
      null;

    // #163: when the visitor explicitly submits the "report this missing
    // page" form on the 404 surface, persist their note onto the log row so
    // editorial sees the context. We append (with a timestamp) rather than
    // overwrite so multiple reports on the same path accumulate.
    const trimmedNote = parsed.data.note?.trim() || null;
    const reportedNote =
      parsed.data.reported && trimmedNote
        ? `[${new Date().toISOString()}] ${trimmedNote.slice(0, 500)}`
        : null;

    await db
      .insert(notFoundLogsTable)
      .values({
        normalizedPath: normalized,
        path: pathname,
        hitCount: 1,
        lastReferrer: referrer,
        lastUserAgent: ua,
        notes: reportedNote,
      })
      .onConflictDoUpdate({
        target: notFoundLogsTable.normalizedPath,
        set: {
          path: pathname,
          // Only bump hitCount on automatic beacons. Explicit "report this
          // missing page" submissions annotate the existing row without
          // double-counting the same visitor/path.
          ...(parsed.data.reported
            ? {}
            : { hitCount: sql`${notFoundLogsTable.hitCount} + 1` }),
          lastSeenAt: new Date(),
          lastReferrer: referrer,
          lastUserAgent: ua,
          ...(reportedNote
            ? {
                notes: sql`coalesce(${notFoundLogsTable.notes} || E'\n', '') || ${reportedNote}`,
              }
            : {}),
        },
      });

    res.status(202).json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "traffic.notFound failed");
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

function mergeQueryWithUtms(
  query: URLSearchParams | null,
  clientUtms: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
  } | null,
): URLSearchParams | null {
  if (!clientUtms) return query;
  const out = new URLSearchParams(query ?? "");
  const mapping: [string, string | null][] = [
    ["utm_source", clientUtms.utmSource],
    ["utm_medium", clientUtms.utmMedium],
    ["utm_campaign", clientUtms.utmCampaign],
    ["utm_term", clientUtms.utmTerm],
    ["utm_content", clientUtms.utmContent],
  ];
  for (const [k, v] of mapping) {
    if (v && !out.get(k)) out.set(k, v);
  }
  return out;
}

interface RecordPageviewArgs {
  req: import("express").Request;
  pathname: string;
  title: string | null;
  referrer: string | null;
  queryString: URLSearchParams | null;
  clientUtms?: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
  };
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
  const { req, pathname, title, referrer, queryString, clientUtms } = args;
  const ua = (req.headers["user-agent"] as string | undefined) ?? "";
  const uaFacts = parseUa(ua);
  const ip = clientIpFromRequest(req);
  const selfHost = selfHostOf(req);
  const geo = countryFromRequest(req);
  // Merge: query-string UTMs take precedence (they came in on the landing URL);
  // fall back to client-reported UTMs if the query string didn't carry them.
  const mergedQuery = mergeQueryWithUtms(queryString, clientUtms ?? null);
  const sourceCls = classifySource({
    referrerUrl: referrer,
    selfHost,
    landingQuery: mergedQuery,
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

// ─── Multi-property ingest endpoint (#228) ────────────────────────────────────
//
// Authenticated batched-pageview ingest for sister Synozur web apps. The
// caller authenticates with `Authorization: Bearer <api-key>` where the key
// was issued at /cms/traffic/properties → create. We bcrypt-compare the key
// against `traffic_properties.api_key_hash` and tag each row with the
// matching property's slug.
//
// Idempotency: rows are de-duped on (sourceSystem, legacy_session_key, path,
// viewedAt) inside ingestPageviewBatch so a sister app that retries a batch
// won't double-count.

// Canonical batch contract — shared with the admin import surface and the
// OpenAPI doc. A batch ALWAYS targets exactly one property (the one the
// API key is bound to), and may contain any combination of session
// metadata, pageviews, and events. Sessions are still derived from the
// pageview rows' sessionKey; the optional `sessions` array lets sister
// apps ship session-level overrides (e.g. country, UA) for sessions that
// have no pageview in this batch.
const IngestEventRow = z.object({
  sessionKey: z.string().min(1),
  eventName: z.string().min(1).max(64),
  occurredAt: z.string().min(1),
  path: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const IngestBody = z
  .object({
    // Optional caller-provided slug. If present it MUST match the
    // authenticated property; mismatch → 403. Defense against a sister app
    // accidentally posting one property's batch with another's key.
    propertySlug: z.string().min(1).max(64).optional(),
    rows: z.array(z.record(z.unknown())).min(1).max(5000).optional(),
    pageviews: z.array(z.record(z.unknown())).max(5000).optional(),
    sessions: z.array(z.record(z.unknown())).max(5000).optional(),
    events: z.array(IngestEventRow).max(5000).optional(),
  })
  .refine(
    (b) =>
      (b.rows && b.rows.length > 0) ||
      (b.pageviews && b.pageviews.length > 0) ||
      (b.sessions && b.sessions.length > 0) ||
      (b.events && b.events.length > 0),
    { message: "must include at least one of rows, pageviews, sessions, or events" },
  );

// Per-property rate limiter — 60 batches/min per key (each batch may carry
// up to 5k rows). Keyed on the API key prefix so a noisy property can't
// starve a quiet one.
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = (req.headers["authorization"] as string | undefined) ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    return `t:i:${token.slice(0, 12) || ipKey(req)}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: "Rate limit exceeded for this property" });
  },
});

router.post("/traffic/ingest", ingestLimiter, async (req, res) => {
  const auth = (req.headers["authorization"] as string | undefined) ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Bearer token" });
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Empty Bearer token" });
    return;
  }
  const prefix = token.slice(0, 8);

  // Look up candidate properties by stored prefix. The prefix isn't unique
  // by itself (rare collision), so we bcrypt-compare against each candidate
  // and pick the matching one.
  const candidates = await db
    .select()
    .from(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.apiKeyPrefix, prefix));

  let matched: typeof candidates[number] | null = null;
  for (const c of candidates) {
    if (!c.isActive || !c.apiKeyHash) continue;
    if (await bcrypt.compare(token, c.apiKeyHash)) {
      matched = c;
      break;
    }
  }
  if (!matched) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const parsed = IngestBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  // If the caller named a property in the body it must match the authed key.
  if (parsed.data.propertySlug && parsed.data.propertySlug !== matched.slug) {
    res.status(403).json({
      error: `propertySlug "${parsed.data.propertySlug}" does not match the authenticated key`,
    });
    return;
  }

  try {
    // Normalize each pageview / session row. Errors are counted but don't
    // fail the batch — sister apps get back per-row diagnostics.
    const pageviewRaw = parsed.data.pageviews ?? parsed.data.rows ?? [];
    const sessionsRaw = parsed.data.sessions ?? [];
    const eventsRaw = parsed.data.events ?? [];
    const errorSamples: Array<{ index: number; reason: string }> = [];

    // Sessions go FIRST so events posted in the same batch can bind to
    // session rows that didn't exist before this request.
    const sessNormalized: IngestSessionRow[] = [];
    let sessNormalizeErrors = 0;
    for (let i = 0; i < sessionsRaw.length; i++) {
      const result = normalizeIngestSessionRow(sessionsRaw[i]!);
      if ("error" in result) {
        sessNormalizeErrors += 1;
        if (errorSamples.length < 10) errorSamples.push({ index: i, reason: `session: ${result.error}` });
        continue;
      }
      sessNormalized.push(result.row);
    }
    const sessionCounters =
      sessNormalized.length > 0
        ? await ingestSessionBatch(matched.slug, sessNormalized)
        : { accepted: 0, duplicates: 0, skipped: 0, errors: 0, errorSamples: [] };

    const normalized: IngestPageviewRow[] = [];
    let normalizeErrors = 0;
    for (let i = 0; i < pageviewRaw.length; i++) {
      const result = normalizeIngestRow(pageviewRaw[i]!);
      if ("error" in result) {
        normalizeErrors += 1;
        if (errorSamples.length < 10) errorSamples.push({ index: i, reason: result.error });
        continue;
      }
      normalized.push(result.row);
    }

    const counters = await ingestPageviewBatch(matched.slug, normalized);

    // Events: look up the session by (sourceSystem, sessionKey). Idempotency
    // requires checking for an existing matching event before insert —
    // otherwise a retry would double-count. Match on
    // (sessionId, eventName, occurredAt, path).
    let eventsAccepted = 0;
    let eventsDuplicates = 0;
    let eventsErrors = 0;
    for (let i = 0; i < eventsRaw.length; i++) {
      const ev = eventsRaw[i]!;
      const occurredAt = new Date(ev.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) {
        eventsErrors += 1;
        if (errorSamples.length < 10) {
          errorSamples.push({ index: i, reason: `event invalid occurredAt: ${ev.occurredAt}` });
        }
        continue;
      }
      const session = await db
        .select({ id: trafficSessionsTable.id })
        .from(trafficSessionsTable)
        .where(
          and(
            eq(trafficSessionsTable.sourceSystem, matched.slug),
            eq(trafficSessionsTable.legacySessionKey, ev.sessionKey),
          ),
        )
        .limit(1);
      if (!session[0]) {
        eventsErrors += 1;
        if (errorSamples.length < 10) {
          errorSamples.push({ index: i, reason: `event sessionKey not found: ${ev.sessionKey}` });
        }
        continue;
      }
      const eventName = ev.eventName.slice(0, 80);
      const evPath = ev.path ?? "";
      const existing = await db
        .select({ id: trafficEventsTable.id })
        .from(trafficEventsTable)
        .where(
          and(
            eq(trafficEventsTable.sessionId, session[0].id),
            eq(trafficEventsTable.eventName, eventName),
            eq(trafficEventsTable.occurredAt, occurredAt),
            eq(trafficEventsTable.path, evPath),
          ),
        )
        .limit(1);
      if (existing[0]) {
        eventsDuplicates += 1;
        continue;
      }
      const propsSerialized = ev.metadata ? JSON.stringify(ev.metadata) : null;
      const safeProps = propsSerialized && propsSerialized.length <= 4096 ? ev.metadata : null;
      await db.insert(trafficEventsTable).values({
        sessionId: session[0].id,
        path: evPath,
        eventName,
        occurredAt,
        properties: safeProps as Record<string, unknown> | null,
      });
      eventsAccepted += 1;
    }

    const totalErrors =
      counters.errors +
      normalizeErrors +
      eventsErrors +
      sessionCounters.errors +
      sessNormalizeErrors;
    const allErrorSamples = [
      ...errorSamples,
      ...counters.errorSamples,
      ...sessionCounters.errorSamples,
    ].slice(0, 10);

    if (totalErrors > 0) {
      req.log.warn(
        {
          propertySlug: matched.slug,
          totalErrors,
          accepted: counters.accepted,
          sessionsAccepted: sessionCounters.accepted,
          eventsAccepted,
          samples: allErrorSamples,
        },
        "traffic.ingest completed with errors",
      );
    }

    res.status(202).json({
      accepted: counters.accepted,
      duplicates: counters.duplicates,
      skipped: counters.skipped,
      errors: totalErrors,
      sessionsAccepted: sessionCounters.accepted,
      sessionsUpdated: sessionCounters.duplicates,
      eventsAccepted,
      eventsDuplicates,
      errorSamples: allErrorSamples,
      rowsParsed: pageviewRaw.length,
      sessionsParsed: sessionsRaw.length,
      eventsParsed: eventsRaw.length,
      propertySlug: matched.slug,
    });
  } catch (err) {
    req.log.error({ err, propertySlug: matched.slug }, "traffic.ingest failed");
    res.status(500).json({ error: "Ingest failed" });
  }
});

export default router;
