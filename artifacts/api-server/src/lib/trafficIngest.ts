/**
 * Shared ingestion helper for the multi-property traffic registry (#228).
 *
 * One canonical pageview-row shape, used by:
 *   - the authenticated POST /api/traffic/ingest endpoint (sister apps push
 *     real-time / batched pageviews here)
 *   - the admin "JSON import" panel (paste a JSON array)
 *   - the admin "CSV import" panel (upload a Wix / GA-style export)
 *
 * All three paths normalize their payload into `IngestPageviewRow[]` and
 * call `ingestPageviewBatch(propertySlug, rows, …)`. The helper:
 *
 *   1. Upserts a `traffic_sessions` row keyed on (source_system, legacy_session_key).
 *      The conflict target is the partial unique index that already exists for
 *      legacy Wix imports, so a re-uploaded export hits the same row.
 *   2. Inserts one `traffic_pageviews` row per source row. `pageviewCount` is
 *      preserved so a Wix-style aggregated row stays aggregated.
 *   3. Returns counters: { accepted, skipped, duplicates, errors }.
 *
 * The helper does NOT touch the live `recordPageview` path — that one stays
 * tuned for the per-request synchronous beacon. Sister apps that want the
 * crawler-classification + UTM-parsing logic should run it on their side
 * before POSTing to /api/traffic/ingest; the ingest endpoint trusts the
 * normalized payload.
 */

import { sql, eq, and } from "drizzle-orm";
import { parseUa } from "./traffic";

/**
 * Strip any domain prefix from a raw path value so that full absolute URLs
 * imported from Wix (e.g. "https://synozur.com/post/foo") and native relative
 * paths ("/post/foo") both land on the same canonical row.
 * Safe to call on anything — non-URL values pass through unchanged.
 */
export function normalizeSitePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return trimmed;
  try {
    const u = new URL(trimmed);
    const p = u.pathname + (u.search && u.search !== "?" ? u.search : "");
    return p || "/";
  } catch {
    return trimmed;
  }
}
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
  trafficPropertiesTable,
} from "@workspace/db";

export interface IngestPageviewRow {
  /**
   * Stable per-row key. Re-uploading the same export with the same
   * sessionKey is idempotent: the upsert finds the existing
   * `(source_system, legacy_session_key)` row and bumps its counters
   * instead of inserting a duplicate. Required.
   */
  sessionKey: string;
  /** Path of the visited page. Required. */
  path: string;
  /** Page title at time of view. Optional. */
  title?: string | null;
  /** When the visit happened. ISO 8601. Required. */
  viewedAt: string;
  /** Aggregated pageview count for this row (Wix exports use this). Defaults to 1. */
  pageviewCount?: number;
  /** Time on page in milliseconds. Optional. */
  timeOnPageMs?: number | null;
  /** Page-type classifier (post / service / home / etc). Optional. */
  pageType?: string | null;
  /** Where the visit came from. Optional. */
  referrerUrl?: string | null;
  referrerHost?: string | null;
  /** First-touch attribution / device for the *session*. */
  trafficSource?:
    | "direct"
    | "organic"
    | "ai"
    | "referral"
    | "social"
    | "paid"
    | "internal"
    | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  deviceType?: "desktop" | "mobile" | "tablet" | "bot" | null;
  browserName?: string | null;
  browserVersion?: string | null;
  osName?: string | null;
  userAgent?: string | null;
  isBot?: boolean | null;
  botName?: string | null;
  botCategory?: string | null;
  landingPath?: string | null;
}

export interface IngestCounters {
  accepted: number;
  skipped: number;
  duplicates: number;
  errors: number;
  errorSamples: Array<{ index: number; reason: string }>;
}

export interface IngestOptions {
  importBatchId?: string | null;
}

const ALLOWED_SOURCES = new Set([
  "direct",
  "organic",
  "ai",
  "referral",
  "social",
  "paid",
  "internal",
]);

const ALLOWED_DEVICES = new Set(["desktop", "mobile", "tablet", "bot"]);

function clamp(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  return String(s).slice(0, max);
}

function parseDate(s: string): Date | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Normalize an unvalidated record (e.g. a raw CSV row) to an
 * IngestPageviewRow. Returns null + a reason if the row is unusable.
 */
export function normalizeIngestRow(
  raw: Record<string, unknown>,
  defaults?: { defaultSessionKey?: string },
): { row: IngestPageviewRow } | { error: string } {
  const path = normalizeSitePath(String(raw["path"] ?? ""));
  if (!path) return { error: "missing path" };
  const viewedAtRaw = String(raw["viewedAt"] ?? raw["timestamp"] ?? raw["date"] ?? "").trim();
  if (!viewedAtRaw) return { error: "missing viewedAt" };
  if (!parseDate(viewedAtRaw)) return { error: `invalid viewedAt: ${viewedAtRaw}` };
  const sessionKey =
    String(raw["sessionKey"] ?? raw["session_id"] ?? raw["sessionId"] ?? "").trim() ||
    defaults?.defaultSessionKey ||
    "";
  if (!sessionKey) return { error: "missing sessionKey" };

  const num = (k: string): number | null => {
    const v = raw[k];
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (k: string): string | null => {
    const v = raw[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  const bool = (k: string): boolean | null => {
    const v = raw[k];
    if (v == null || v === "") return null;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return null;
  };

  // Server-side UA parsing fallback. Sister apps that ship a `userAgent`
  // string but no parsed UA fields get the same browser/os/device/bot
  // classification as native collection (#228 review). Explicit caller-
  // provided values always win.
  const userAgent = str("userAgent") ?? str("user_agent");
  let uaBrowserName: string | null = null;
  let uaBrowserVersion: string | null = null;
  let uaOsName: string | null = null;
  let uaDeviceType: string | null = null;
  let uaIsBot: boolean | null = null;
  let uaBotName: string | null = null;
  let uaBotCategory: string | null = null;
  if (userAgent) {
    const facts = parseUa(userAgent);
    uaBrowserName = facts.browserName;
    uaBrowserVersion = facts.browserVersion;
    uaOsName = facts.osName;
    uaDeviceType = facts.deviceType;
    uaIsBot = facts.isBot;
    uaBotName = facts.botName;
    uaBotCategory = facts.botCategory;
  }

  const trafficSource = str("trafficSource");
  if (trafficSource && !ALLOWED_SOURCES.has(trafficSource)) {
    return { error: `invalid trafficSource: ${trafficSource}` };
  }
  const deviceType = str("deviceType");
  if (deviceType && !ALLOWED_DEVICES.has(deviceType)) {
    return { error: `invalid deviceType: ${deviceType}` };
  }

  return {
    row: {
      sessionKey,
      path,
      viewedAt: viewedAtRaw,
      title: str("title"),
      pageviewCount: num("pageviewCount") ?? num("pageviews") ?? 1,
      timeOnPageMs: num("timeOnPageMs"),
      pageType: str("pageType"),
      referrerUrl: str("referrerUrl") ?? str("referrer"),
      referrerHost: str("referrerHost"),
      trafficSource: trafficSource as IngestPageviewRow["trafficSource"],
      utmSource: str("utmSource"),
      utmMedium: str("utmMedium"),
      utmCampaign: str("utmCampaign"),
      utmTerm: str("utmTerm"),
      utmContent: str("utmContent"),
      country: str("country")?.toUpperCase().slice(0, 2) ?? null,
      region: str("region"),
      city: str("city"),
      deviceType: ((deviceType ?? uaDeviceType) as IngestPageviewRow["deviceType"]) ?? null,
      browserName: str("browserName") ?? str("browser") ?? uaBrowserName,
      browserVersion: str("browserVersion") ?? uaBrowserVersion,
      osName: str("osName") ?? str("os") ?? uaOsName,
      userAgent,
      isBot: bool("isBot") ?? uaIsBot ?? false,
      botName: str("botName") ?? uaBotName,
      botCategory: str("botCategory") ?? uaBotCategory,
      landingPath: str("landingPath") ?? path,
    },
  };
}

/**
 * Look up a property by slug. Returns null if not found OR inactive.
 */
export async function findActiveProperty(
  slug: string,
): Promise<{ id: string; slug: string } | null> {
  const [row] = await db
    .select({
      id: trafficPropertiesTable.id,
      slug: trafficPropertiesTable.slug,
      isActive: trafficPropertiesTable.isActive,
    })
    .from(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.slug, slug))
    .limit(1);
  if (!row || !row.isActive) return null;
  return { id: row.id, slug: row.slug };
}

/**
 * Ingest a batch of pageview rows for a given property. Idempotent on
 * (source_system, sessionKey, path, viewedAt).
 */
export async function ingestPageviewBatch(
  propertySlug: string,
  rows: IngestPageviewRow[],
  opts: IngestOptions = {},
): Promise<IngestCounters> {
  const counters: IngestCounters = {
    accepted: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    errorSamples: [],
  };

  const importBatchId = opts.importBatchId ?? null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    try {
      const viewedAt = parseDate(r.viewedAt);
      if (!viewedAt) {
        counters.errors += 1;
        if (counters.errorSamples.length < 10) {
          counters.errorSamples.push({ index: i, reason: "invalid viewedAt" });
        }
        continue;
      }

      // Idempotency requires us to check for an existing pageview BEFORE
      // touching the session row — otherwise a duplicate retry would still
      // bump traffic_sessions.pageview_count and skew session-derived
      // reporting. So we look up the session first; if it already exists
      // and the pageview at (path, viewedAt) is already recorded, we skip
      // the entire row without mutating anything.
      const pageviewN = r.pageviewCount ?? 1;
      const existingSession = await db
        .select({ id: trafficSessionsTable.id })
        .from(trafficSessionsTable)
        .where(
          and(
            eq(trafficSessionsTable.sourceSystem, propertySlug),
            eq(trafficSessionsTable.legacySessionKey, r.sessionKey),
          ),
        )
        .limit(1);

      let sessionId: string;
      if (existingSession[0]) {
        sessionId = existingSession[0].id;
        const existing = await db
          .select({ id: trafficPageviewsTable.id })
          .from(trafficPageviewsTable)
          .where(
            and(
              eq(trafficPageviewsTable.sessionId, sessionId),
              eq(trafficPageviewsTable.path, r.path),
              eq(trafficPageviewsTable.viewedAt, viewedAt),
              eq(trafficPageviewsTable.sourceSystem, propertySlug),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          counters.duplicates += 1;
          continue;
        }
        // Fresh pageview on an existing session — bump session counters now.
        await db
          .update(trafficSessionsTable)
          .set({
            lastSeenAt: viewedAt,
            pageviewCount: sql`${trafficSessionsTable.pageviewCount} + ${pageviewN}`,
          })
          .where(eq(trafficSessionsTable.id, sessionId));
      } else {
        const inserted = await db
          .insert(trafficSessionsTable)
          .values({
            sessionHash: `${propertySlug}:${r.sessionKey}`.slice(0, 128),
            firstSeenAt: viewedAt,
            lastSeenAt: viewedAt,
            userAgent: clamp(r.userAgent, 1024),
            browserName: clamp(r.browserName, 64),
            browserVersion: clamp(r.browserVersion, 32),
            osName: clamp(r.osName, 64),
            deviceType: r.deviceType ?? null,
            // ipHash is NOT NULL on the table. Ingested rows don't carry
            // an IP hash (sister apps strip it before sending), so we use
            // an empty string sentinel.
            ipHash: "",
            country: r.country ?? null,
            region: clamp(r.region, 128),
            city: clamp(r.city, 128),
            landingPath: clamp(r.landingPath ?? r.path, 2048),
            referrerUrl: clamp(r.referrerUrl, 2048),
            referrerHost: clamp(r.referrerHost, 256),
            trafficSource: r.trafficSource ?? null,
            utmSource: clamp(r.utmSource, 120),
            utmMedium: clamp(r.utmMedium, 120),
            utmCampaign: clamp(r.utmCampaign, 120),
            utmTerm: clamp(r.utmTerm, 120),
            utmContent: clamp(r.utmContent, 120),
            isBot: r.isBot ?? false,
            botName: clamp(r.botName, 64),
            botCategory: clamp(r.botCategory, 32),
            pageviewCount: pageviewN,
            sourceSystem: propertySlug,
            importBatchId,
            legacySessionKey: r.sessionKey,
          })
          .onConflictDoNothing({
            target: [trafficSessionsTable.sourceSystem, trafficSessionsTable.legacySessionKey],
          })
          .returning({ id: trafficSessionsTable.id });
        // If the conflict path was hit (rare race with a concurrent batch),
        // re-fetch the existing row.
        if (inserted[0]) {
          sessionId = inserted[0].id;
        } else {
          const refetch = await db
            .select({ id: trafficSessionsTable.id })
            .from(trafficSessionsTable)
            .where(
              and(
                eq(trafficSessionsTable.sourceSystem, propertySlug),
                eq(trafficSessionsTable.legacySessionKey, r.sessionKey),
              ),
            )
            .limit(1);
          if (!refetch[0]) {
            counters.errors += 1;
            if (counters.errorSamples.length < 10) {
              counters.errorSamples.push({ index: i, reason: "session upsert race" });
            }
            continue;
          }
          sessionId = refetch[0].id;
        }
      }
      const session = { id: sessionId };

      await db.insert(trafficPageviewsTable).values({
        sessionId: session.id,
        path: clamp(r.path, 2048)!,
        pageType: clamp(r.pageType, 32),
        title: clamp(r.title, 512),
        referrerUrl: clamp(r.referrerUrl, 2048),
        referrerHost: clamp(r.referrerHost, 256),
        viewedAt,
        timeOnPageMs: r.timeOnPageMs ?? null,
        pageviewCount: r.pageviewCount ?? 1,
        sourceSystem: propertySlug,
        importBatchId,
      });
      counters.accepted += 1;
    } catch (err) {
      counters.errors += 1;
      if (counters.errorSamples.length < 10) {
        counters.errorSamples.push({
          index: i,
          reason: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
  }

  // Touch lastIngestedAt on the property.
  if (counters.accepted > 0 || counters.duplicates > 0) {
    await db
      .update(trafficPropertiesTable)
      .set({ lastIngestedAt: new Date(), updatedAt: new Date() })
      .where(eq(trafficPropertiesTable.slug, propertySlug));
  }

  return counters;
}

// ─── Session-only ingestion ─────────────────────────────────────────────────
//
// Session-only batches let sister apps push session metadata for sessions
// that have no pageview in this batch (e.g. an SPA tracking only events,
// or a backfill that ships sessions ahead of pageviews). Events posted in
// the same batch can then bind to these sessions.

export interface IngestSessionRow {
  sessionKey: string;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  userAgent?: string | null;
  browserName?: string | null;
  browserVersion?: string | null;
  osName?: string | null;
  deviceType?: "desktop" | "mobile" | "tablet" | "bot" | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  landingPath?: string | null;
  referrerUrl?: string | null;
  referrerHost?: string | null;
  trafficSource?: IngestPageviewRow["trafficSource"];
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  isBot?: boolean | null;
  botName?: string | null;
  botCategory?: string | null;
}

export function normalizeIngestSessionRow(
  raw: Record<string, unknown>,
): { row: IngestSessionRow } | { error: string } {
  const sessionKey = String(raw["sessionKey"] ?? raw["session_id"] ?? "").trim();
  if (!sessionKey) return { error: "missing sessionKey" };

  const str = (k: string): string | null => {
    const v = raw[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  const bool = (k: string): boolean | null => {
    const v = raw[k];
    if (v == null || v === "") return null;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    if (["true", "1", "yes"].includes(s)) return true;
    if (["false", "0", "no"].includes(s)) return false;
    return null;
  };

  const userAgent = str("userAgent") ?? str("user_agent");
  const facts = userAgent ? parseUa(userAgent) : null;
  const trafficSource = str("trafficSource");
  if (trafficSource && !ALLOWED_SOURCES.has(trafficSource)) {
    return { error: `invalid trafficSource: ${trafficSource}` };
  }
  const deviceType = str("deviceType") ?? facts?.deviceType ?? null;
  if (deviceType && !ALLOWED_DEVICES.has(deviceType)) {
    return { error: `invalid deviceType: ${deviceType}` };
  }

  return {
    row: {
      sessionKey,
      firstSeenAt: str("firstSeenAt"),
      lastSeenAt: str("lastSeenAt"),
      userAgent,
      browserName: str("browserName") ?? facts?.browserName ?? null,
      browserVersion: str("browserVersion") ?? facts?.browserVersion ?? null,
      osName: str("osName") ?? facts?.osName ?? null,
      deviceType: deviceType as IngestSessionRow["deviceType"],
      country: str("country")?.toUpperCase().slice(0, 2) ?? null,
      region: str("region"),
      city: str("city"),
      landingPath: str("landingPath") !== null ? normalizeSitePath(str("landingPath")!) : null,
      referrerUrl: str("referrerUrl"),
      referrerHost: str("referrerHost"),
      trafficSource: trafficSource as IngestPageviewRow["trafficSource"],
      utmSource: str("utmSource"),
      utmMedium: str("utmMedium"),
      utmCampaign: str("utmCampaign"),
      utmTerm: str("utmTerm"),
      utmContent: str("utmContent"),
      isBot: bool("isBot") ?? facts?.isBot ?? null,
      botName: str("botName") ?? facts?.botName ?? null,
      botCategory: str("botCategory") ?? facts?.botCategory ?? null,
    },
  };
}

/**
 * Upsert session-only rows for a property. Idempotent on
 * (source_system, legacy_session_key). Existing sessions are updated with
 * any non-null fields supplied (last-write-wins); brand new sessions are
 * inserted. pageview_count is NEVER touched here — that counter is owned
 * by ingestPageviewBatch.
 */
export async function ingestSessionBatch(
  propertySlug: string,
  rows: IngestSessionRow[],
): Promise<IngestCounters> {
  const counters: IngestCounters = {
    accepted: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    errorSamples: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    try {
      const firstSeen = r.firstSeenAt ? new Date(r.firstSeenAt) : new Date();
      const lastSeen = r.lastSeenAt ? new Date(r.lastSeenAt) : firstSeen;
      if (Number.isNaN(firstSeen.getTime()) || Number.isNaN(lastSeen.getTime())) {
        counters.errors += 1;
        if (counters.errorSamples.length < 10) {
          counters.errorSamples.push({ index: i, reason: "invalid firstSeenAt/lastSeenAt" });
        }
        continue;
      }

      const existing = await db
        .select({ id: trafficSessionsTable.id })
        .from(trafficSessionsTable)
        .where(
          and(
            eq(trafficSessionsTable.sourceSystem, propertySlug),
            eq(trafficSessionsTable.legacySessionKey, r.sessionKey),
          ),
        )
        .limit(1);

      if (existing[0]) {
        // Last-write-wins update for any non-null fields. Avoid clobbering
        // populated metadata with NULLs from a sparse override.
        const patch: Record<string, unknown> = { lastSeenAt: lastSeen };
        const setIf = (k: string, v: unknown) => {
          if (v != null && v !== "") patch[k] = v;
        };
        setIf("userAgent", clamp(r.userAgent, 1024));
        setIf("browserName", clamp(r.browserName, 64));
        setIf("browserVersion", clamp(r.browserVersion, 32));
        setIf("osName", clamp(r.osName, 64));
        setIf("deviceType", r.deviceType);
        setIf("country", r.country);
        setIf("region", clamp(r.region, 128));
        setIf("city", clamp(r.city, 128));
        setIf("landingPath", clamp(r.landingPath, 2048));
        setIf("referrerUrl", clamp(r.referrerUrl, 2048));
        setIf("referrerHost", clamp(r.referrerHost, 256));
        setIf("trafficSource", r.trafficSource);
        setIf("utmSource", clamp(r.utmSource, 120));
        setIf("utmMedium", clamp(r.utmMedium, 120));
        setIf("utmCampaign", clamp(r.utmCampaign, 120));
        setIf("utmTerm", clamp(r.utmTerm, 120));
        setIf("utmContent", clamp(r.utmContent, 120));
        if (r.isBot != null) patch.isBot = r.isBot;
        setIf("botName", clamp(r.botName, 64));
        setIf("botCategory", clamp(r.botCategory, 32));
        await db
          .update(trafficSessionsTable)
          .set(patch)
          .where(eq(trafficSessionsTable.id, existing[0].id));
        counters.duplicates += 1;
        continue;
      }

      await db
        .insert(trafficSessionsTable)
        .values({
          sessionHash: `${propertySlug}:${r.sessionKey}`.slice(0, 128),
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
          userAgent: clamp(r.userAgent, 1024),
          browserName: clamp(r.browserName, 64),
          browserVersion: clamp(r.browserVersion, 32),
          osName: clamp(r.osName, 64),
          deviceType: r.deviceType ?? null,
          ipHash: "",
          country: r.country ?? null,
          region: clamp(r.region, 128),
          city: clamp(r.city, 128),
          landingPath: clamp(r.landingPath, 2048),
          referrerUrl: clamp(r.referrerUrl, 2048),
          referrerHost: clamp(r.referrerHost, 256),
          trafficSource: r.trafficSource ?? null,
          utmSource: clamp(r.utmSource, 120),
          utmMedium: clamp(r.utmMedium, 120),
          utmCampaign: clamp(r.utmCampaign, 120),
          utmTerm: clamp(r.utmTerm, 120),
          utmContent: clamp(r.utmContent, 120),
          isBot: r.isBot ?? false,
          botName: clamp(r.botName, 64),
          botCategory: clamp(r.botCategory, 32),
          pageviewCount: 0,
          sourceSystem: propertySlug,
          legacySessionKey: r.sessionKey,
        })
        .onConflictDoNothing({
          target: [trafficSessionsTable.sourceSystem, trafficSessionsTable.legacySessionKey],
        });
      counters.accepted += 1;
    } catch (err) {
      counters.errors += 1;
      if (counters.errorSamples.length < 10) {
        counters.errorSamples.push({
          index: i,
          reason: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
  }

  if (counters.accepted > 0 || counters.duplicates > 0) {
    await db
      .update(trafficPropertiesTable)
      .set({ lastIngestedAt: new Date(), updatedAt: new Date() })
      .where(eq(trafficPropertiesTable.slug, propertySlug));
  }

  return counters;
}
