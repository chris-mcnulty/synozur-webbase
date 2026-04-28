/**
 * Legacy traffic importer.
 *
 *   pnpm --filter @workspace/legacy-traffic-import import \
 *     --file data/legacy-traffic/wix_2026-01-01_2026-04-29.csv [--dry-run] [--final]
 *
 * Parses a Wix Analytics detail-row export and merges it into the live
 * traffic_sessions / traffic_pageviews tables tagged with source_system='wix'.
 * Re-running the same file is a no-op (legacy_traffic_batches keys on the
 * file's sha256, sessions key on legacy_session_key).
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import {
  db,
  trafficSessionsTable,
  trafficPageviewsTable,
  legacyTrafficBatchesTable,
  legacyTrafficUnmappedTable,
  postsTable,
  postViewsTable,
} from "@workspace/db";
import { sql, inArray } from "drizzle-orm";
import {
  classifyTrafficSource,
  countryCode,
  deviceTypeFromWix,
  fileSha256,
  hostOf,
  ipHash,
  legacySessionKey,
  normalizePath,
  nullable,
  parseDate,
  parseDuration,
  parsePercent,
  toUtcDate,
} from "./util";
import { loadResolverCaches, resolvePath, type ResolverCaches } from "./resolve";

interface CliArgs {
  file: string;
  sourceSystem: string;
  dryRun: boolean;
  isFinal: boolean;
  notes: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let file: string | null = null;
  let sourceSystem = "wix";
  let dryRun = false;
  let isFinal = false;
  let notes: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") file = argv[++i] ?? null;
    else if (arg === "--source") sourceSystem = argv[++i] ?? "wix";
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--final") isFinal = true;
    else if (arg === "--notes") notes = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (!file) {
    printHelp();
    process.exit(2);
  }
  return { file, sourceSystem, dryRun, isFinal, notes };
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: import --file <path> [--source wix] [--dry-run] [--final] [--notes <text>]",
      "",
      "  --file <path>   CSV exported from Wix Analytics (detail rows).",
      "  --source <id>   Source system id; defaults to 'wix'.",
      "  --dry-run       Parse + resolve only; no DB writes.",
      "  --final         Mark this batch as the final cutover import.",
      "  --notes <text>  Free-form note attached to the batch row.",
      "",
    ].join("\n"),
  );
}

interface RawRow {
  pagePath: string;
  date: string;
  hour: number | null;
  browser: string | null;
  browserVersion: string | null;
  deviceType: string | null;
  os: string | null;
  city: string | null;
  country: string | null;
  ip: string | null;
  region: string | null;
  pageUrl: string | null;
  trafficCategory: string | null;
  trafficSource: string | null;
  trafficSourceUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  visitorType: string;
  isMember: boolean;
  pageViews: number;
  sessions: number;
  uniqueVisitors: number;
  avgSessionDurationMs: number | null;
  avgTimeOnPageMs: number | null;
  bounceRatePct: number | null;
}

function rowFromCsv(record: Record<string, string>): RawRow | null {
  const pagePath = record["Page path"];
  const dateRaw = record["Date"];
  if (!pagePath || !dateRaw) return null;
  const date = parseDate(dateRaw);
  if (!date) return null;
  const hourRaw = record["Session hour"];
  const hour = hourRaw && hourRaw !== "_" ? Number(hourRaw) : null;
  const pageViews = Number(record["Page views"] ?? "0");
  const sessions = Number(record["Site sessions"] ?? "0");
  const uniqueVisitors = Number(record["Unique visitors"] ?? "0");

  return {
    pagePath,
    date,
    hour: Number.isFinite(hour) ? (hour as number) : null,
    browser: nullable(record["Browser"]),
    browserVersion: nullable(record["Browser version"]),
    deviceType: nullable(record["Device type"]),
    os: nullable(record["Operating system"]),
    city: nullable(record["City"]),
    country: nullable(record["Country"]),
    ip: nullable(record["IP address"]),
    region: nullable(record["Region"]),
    pageUrl: nullable(record["Page URL"]),
    trafficCategory: nullable(record["Traffic category"]),
    trafficSource: nullable(record["Traffic source"]),
    trafficSourceUrl: nullable(record["Traffic source URL"]),
    utmSource: nullable(record["UTM campaign source"]),
    utmMedium: nullable(record["UTM campaign medium"]),
    utmCampaign: nullable(record["UTM campaign name"]),
    utmTerm: nullable(record["UTM campaign keywords"]),
    utmContent: nullable(record["UTM campaign content"]),
    visitorType: record["Visitor type"] ?? "Unknown",
    isMember: (record["Site member"] ?? "").toLowerCase() === "true",
    pageViews: Number.isFinite(pageViews) ? pageViews : 0,
    sessions: Number.isFinite(sessions) ? sessions : 0,
    uniqueVisitors: Number.isFinite(uniqueVisitors) ? uniqueVisitors : 0,
    avgSessionDurationMs: parseDuration(record["Avg. session duration"]),
    avgTimeOnPageMs: parseDuration(record["Avg. time on page"]),
    bounceRatePct: parsePercent(record["Bounce rate"]),
  };
}

interface PreparedSession {
  legacySessionKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  pageviewCount: number;
  userAgent: string;
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  deviceType: "desktop" | "mobile" | "tablet" | "bot";
  ipHash: string;
  country: string | null;
  region: string | null;
  city: string | null;
  landingPath: string;
  referrerUrl: string | null;
  referrerHost: string | null;
  trafficSource: ReturnType<typeof classifyTrafficSource>;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  isBot: boolean;
}

interface PreparedPageview {
  legacySessionKey: string;
  viewedAt: Date;
  path: string;
  resolvedPath: string | null;
  pageType: string;
  postSlug: string | null;
  referrerUrl: string | null;
  referrerHost: string | null;
  timeOnPageMs: number | null;
  pageviewCount: number;
}

interface UnmappedAccumulator {
  occurrences: number;
  pageviews: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  samplePageType: string;
  samplePageUrl: string | null;
}

interface PreparedBatch {
  sessions: PreparedSession[];
  pageviews: PreparedPageview[];
  unmapped: Map<string, UnmappedAccumulator>;
  rangeFrom: Date | null;
  rangeTo: Date | null;
  rowCount: number;
}

function prepareRows(rows: RawRow[], caches: ResolverCaches): PreparedBatch {
  const sessions = new Map<string, PreparedSession>();
  const pageviews: PreparedPageview[] = [];
  const unmapped = new Map<string, UnmappedAccumulator>();
  let rangeFrom: Date | null = null;
  let rangeTo: Date | null = null;

  for (const row of rows) {
    const viewedAt = toUtcDate(row.date, row.hour);
    if (!rangeFrom || viewedAt < rangeFrom) rangeFrom = viewedAt;
    if (!rangeTo || viewedAt > rangeTo) rangeTo = viewedAt;

    // Synthesize a UA string the live parser would understand. We don't have
    // the real UA from Wix, so we string together browser/version/OS/device.
    const ua = [
      row.browser ?? "Unknown",
      row.browserVersion ? `/${row.browserVersion}` : "",
      row.os ? ` (${row.os})` : "",
      row.deviceType ? ` ${row.deviceType}` : "",
    ]
      .join("")
      .trim();

    const ip = row.ip ?? "0.0.0.0";
    const sessKey = legacySessionKey({
      date: row.date,
      hour: row.hour,
      ip,
      userAgent: ua,
      country: row.country ?? "",
      visitorType: row.visitorType,
    });

    const referrerHost = hostOf(row.trafficSourceUrl);
    const trafficSource = classifyTrafficSource({
      trafficCategory: row.trafficCategory,
      trafficSource: row.trafficSource,
      trafficSourceUrl: row.trafficSourceUrl,
      utmSource: row.utmSource,
    });

    let session = sessions.get(sessKey);
    if (!session) {
      session = {
        legacySessionKey: sessKey,
        firstSeenAt: viewedAt,
        lastSeenAt: viewedAt,
        pageviewCount: 0,
        userAgent: ua,
        browserName: row.browser,
        browserVersion: row.browserVersion,
        osName: row.os,
        deviceType: deviceTypeFromWix(row.deviceType),
        ipHash: ipHash(ip),
        country: countryCode(row.country),
        region: row.region,
        city: row.city,
        landingPath: normalizePath(row.pagePath),
        referrerUrl: row.trafficSourceUrl,
        referrerHost,
        trafficSource,
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        utmTerm: row.utmTerm,
        utmContent: row.utmContent,
        isBot: false, // Wix's UI strips bots from the export already
      };
      sessions.set(sessKey, session);
    } else {
      // Same session key — extend the time range and accumulate pageviews.
      if (viewedAt < session.firstSeenAt) {
        session.firstSeenAt = viewedAt;
        session.landingPath = normalizePath(row.pagePath);
      }
      if (viewedAt > session.lastSeenAt) session.lastSeenAt = viewedAt;
    }
    session.pageviewCount += Math.max(1, row.pageViews);

    const resolution = resolvePath(row.pagePath, caches);
    pageviews.push({
      legacySessionKey: sessKey,
      viewedAt,
      path: normalizePath(row.pagePath),
      resolvedPath: resolution.resolvedPath,
      pageType: resolution.pageType,
      postSlug: resolution.postSlug,
      referrerUrl: row.trafficSourceUrl,
      referrerHost,
      timeOnPageMs: row.avgTimeOnPageMs,
      pageviewCount: Math.max(1, row.pageViews),
    });

    if (!resolution.resolvedPath) {
      const key = normalizePath(row.pagePath);
      const existing = unmapped.get(key);
      if (existing) {
        existing.occurrences += 1;
        existing.pageviews += Math.max(1, row.pageViews);
        if (viewedAt < existing.firstSeenAt) existing.firstSeenAt = viewedAt;
        if (viewedAt > existing.lastSeenAt) existing.lastSeenAt = viewedAt;
      } else {
        unmapped.set(key, {
          occurrences: 1,
          pageviews: Math.max(1, row.pageViews),
          firstSeenAt: viewedAt,
          lastSeenAt: viewedAt,
          samplePageType: resolution.pageType,
          samplePageUrl: row.pageUrl,
        });
      }
    }
  }

  return {
    sessions: [...sessions.values()],
    pageviews,
    unmapped,
    rangeFrom,
    rangeTo,
    rowCount: rows.length,
  };
}

async function writeBatch(
  args: CliArgs,
  prepared: PreparedBatch,
  meta: { sourceFile: string; sourceFileSha256: string },
): Promise<{
  batchId: string;
  sessionsInserted: number;
  pageviewsInserted: number;
  postViewsInserted: number;
  unmappedInserted: number;
}> {
  // Skip if a batch with the same file sha already exists.
  const existing = await db
    .select({
      id: legacyTrafficBatchesTable.id,
      sessionsInserted: legacyTrafficBatchesTable.sessionsInserted,
      pageviewsInserted: legacyTrafficBatchesTable.pageviewsInserted,
      unmappedCount: legacyTrafficBatchesTable.unmappedCount,
    })
    .from(legacyTrafficBatchesTable)
    .where(
      sql`${legacyTrafficBatchesTable.sourceSystem} = ${args.sourceSystem}
          and ${legacyTrafficBatchesTable.sourceFileSha256} = ${meta.sourceFileSha256}`,
    )
    .limit(1);
  if (existing.length > 0) {
    const e = existing[0]!;
    process.stdout.write(
      `Batch already imported (id=${e.id}); skipping. Re-run with a new file to import again.\n`,
    );
    return {
      batchId: e.id,
      sessionsInserted: e.sessionsInserted,
      pageviewsInserted: e.pageviewsInserted,
      postViewsInserted: 0,
      unmappedInserted: e.unmappedCount,
    };
  }

  const [batchRow] = await db
    .insert(legacyTrafficBatchesTable)
    .values({
      sourceSystem: args.sourceSystem,
      sourceFile: meta.sourceFile,
      sourceFileSha256: meta.sourceFileSha256,
      rangeFrom: prepared.rangeFrom,
      rangeTo: prepared.rangeTo,
      rowCount: prepared.rowCount,
      isFinal: args.isFinal,
      notes: args.notes,
    })
    .returning({ id: legacyTrafficBatchesTable.id });
  const batchId = batchRow!.id;

  // Insert sessions in chunks. ON CONFLICT (legacy_session_key) DO NOTHING
  // makes a re-run idempotent across batches that touch the same session.
  const sessKeyToId = new Map<string, string>();
  const SESSION_CHUNK = 500;
  let sessionsInserted = 0;
  for (let i = 0; i < prepared.sessions.length; i += SESSION_CHUNK) {
    const chunk = prepared.sessions.slice(i, i + SESSION_CHUNK);
    const inserted = await db
      .insert(trafficSessionsTable)
      .values(
        chunk.map((s) => ({
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          pageviewCount: s.pageviewCount,
          sessionHash: s.legacySessionKey, // reuse for the unique-not-null sessionHash column
          userAgent: s.userAgent,
          browserName: s.browserName,
          browserVersion: s.browserVersion,
          osName: s.osName,
          deviceType: s.deviceType,
          ipHash: s.ipHash,
          country: s.country,
          region: s.region,
          city: s.city,
          landingPath: s.landingPath,
          referrerUrl: s.referrerUrl,
          referrerHost: s.referrerHost,
          trafficSource: s.trafficSource,
          utmSource: s.utmSource,
          utmMedium: s.utmMedium,
          utmCampaign: s.utmCampaign,
          utmTerm: s.utmTerm,
          utmContent: s.utmContent,
          isBot: s.isBot,
          sourceSystem: args.sourceSystem,
          importBatchId: batchId,
          legacySessionKey: s.legacySessionKey,
        })),
      )
      .onConflictDoNothing({ target: trafficSessionsTable.legacySessionKey })
      .returning({
        id: trafficSessionsTable.id,
        legacySessionKey: trafficSessionsTable.legacySessionKey,
      });
    for (const r of inserted) {
      if (r.legacySessionKey) sessKeyToId.set(r.legacySessionKey, r.id);
    }
    sessionsInserted += inserted.length;
  }

  // Backfill any session_keys that were skipped by ON CONFLICT (existed from
  // a prior batch). Look them up so pageviews can FK correctly.
  const missing = prepared.sessions
    .map((s) => s.legacySessionKey)
    .filter((k) => !sessKeyToId.has(k));
  if (missing.length > 0) {
    const LOOKUP_CHUNK = 500;
    for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
      const chunk = missing.slice(i, i + LOOKUP_CHUNK);
      const rows = await db
        .select({
          id: trafficSessionsTable.id,
          legacySessionKey: trafficSessionsTable.legacySessionKey,
        })
        .from(trafficSessionsTable)
        .where(inArray(trafficSessionsTable.legacySessionKey, chunk));
      for (const r of rows) {
        if (r.legacySessionKey) sessKeyToId.set(r.legacySessionKey, r.id);
      }
    }
  }

  // Insert pageviews tied to their sessions.
  let pageviewsInserted = 0;
  const PAGEVIEW_CHUNK = 1000;
  const pageviewValues = prepared.pageviews
    .map((p) => {
      const sessionId = sessKeyToId.get(p.legacySessionKey);
      if (!sessionId) return null;
      return {
        sessionId,
        viewedAt: p.viewedAt,
        path: p.path,
        pageType: p.pageType,
        title: null as string | null,
        referrerUrl: p.referrerUrl,
        referrerHost: p.referrerHost,
        timeOnPageMs: p.timeOnPageMs,
        scrollDepthPct: null as number | null,
        sourceSystem: args.sourceSystem,
        importBatchId: batchId,
        pageviewCount: p.pageviewCount,
        resolvedPath: p.resolvedPath,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  for (let i = 0; i < pageviewValues.length; i += PAGEVIEW_CHUNK) {
    const chunk = pageviewValues.slice(i, i + PAGEVIEW_CHUNK);
    const inserted = await db
      .insert(trafficPageviewsTable)
      .values(chunk)
      .returning({ id: trafficPageviewsTable.id });
    pageviewsInserted += inserted.length;
  }

  // Mirror legacy pageviews of resolved blog posts into post_views so the
  // per-post analytics dashboard reflects YTD numbers automatically. We
  // expand each legacy pageview row into N post_views rows (where N =
  // pageviewCount, capped at 50 to defend against pathological export data),
  // because post_views has no count column. The volumes here are bounded by
  // the legacy CSV size — well under the post_views table's normal scale.
  const slugToPostId = new Map<string, string>();
  const slugsToFetch = [
    ...new Set(
      prepared.pageviews
        .map((p) => p.postSlug)
        .filter((s): s is string => s != null),
    ),
  ];
  if (slugsToFetch.length > 0) {
    const POST_LOOKUP_CHUNK = 200;
    for (let i = 0; i < slugsToFetch.length; i += POST_LOOKUP_CHUNK) {
      const chunk = slugsToFetch.slice(i, i + POST_LOOKUP_CHUNK);
      const rows = await db
        .select({ id: postsTable.id, slug: postsTable.slug })
        .from(postsTable)
        .where(inArray(postsTable.slug, chunk));
      for (const r of rows) slugToPostId.set(r.slug.toLowerCase(), r.id);
    }
  }

  let postViewsInserted = 0;
  const POST_VIEW_CHUNK = 1000;
  const postViewValues: Array<typeof postViewsTable.$inferInsert> = [];
  for (const p of prepared.pageviews) {
    if (!p.postSlug) continue;
    const postId = slugToPostId.get(p.postSlug.toLowerCase());
    if (!postId) continue;
    const expand = Math.min(50, Math.max(1, p.pageviewCount));
    for (let n = 0; n < expand; n++) {
      postViewValues.push({
        postId,
        viewedAt: p.viewedAt,
        sessionHash: `legacy:${batchId}:${p.legacySessionKey}:${n}`,
        referrerHost: p.referrerHost,
        referrerUrl: p.referrerUrl,
        userAgent: null,
      });
    }
  }
  for (let i = 0; i < postViewValues.length; i += POST_VIEW_CHUNK) {
    const chunk = postViewValues.slice(i, i + POST_VIEW_CHUNK);
    const inserted = await db
      .insert(postViewsTable)
      .values(chunk)
      .returning({ id: postViewsTable.id });
    postViewsInserted += inserted.length;
  }

  // Upsert unmapped paths into the triage table.
  let unmappedInserted = 0;
  for (const [path, info] of prepared.unmapped.entries()) {
    await db
      .insert(legacyTrafficUnmappedTable)
      .values({
        sourceSystem: args.sourceSystem,
        sourcePath: path,
        firstSeenAt: info.firstSeenAt,
        lastSeenAt: info.lastSeenAt,
        occurrences: info.occurrences,
        pageviews: info.pageviews,
        samplePageType: info.samplePageType,
        sample: { samplePageUrl: info.samplePageUrl },
      })
      .onConflictDoUpdate({
        target: [
          legacyTrafficUnmappedTable.sourceSystem,
          legacyTrafficUnmappedTable.sourcePath,
        ],
        set: {
          occurrences: sql`${legacyTrafficUnmappedTable.occurrences} + ${info.occurrences}`,
          pageviews: sql`${legacyTrafficUnmappedTable.pageviews} + ${info.pageviews}`,
          lastSeenAt: sql`greatest(${legacyTrafficUnmappedTable.lastSeenAt}, ${info.lastSeenAt})`,
        },
      });
    unmappedInserted += 1;
  }

  await db
    .update(legacyTrafficBatchesTable)
    .set({
      sessionsInserted,
      pageviewsInserted,
      unmappedCount: unmappedInserted,
    })
    .where(sql`${legacyTrafficBatchesTable.id} = ${batchId}`);

  return {
    batchId,
    sessionsInserted,
    pageviewsInserted,
    postViewsInserted,
    unmappedInserted,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const absPath = path.resolve(args.file);
  if (!fs.existsSync(absPath)) {
    process.stderr.write(`File not found: ${absPath}\n`);
    process.exit(1);
  }

  process.stdout.write(`Reading ${absPath} ...\n`);
  const csvText = fs.readFileSync(absPath, "utf8");
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
  const rows: RawRow[] = [];
  for (const r of records) {
    const row = rowFromCsv(r);
    if (row) rows.push(row);
  }
  process.stdout.write(`Parsed ${rows.length} valid rows from ${records.length} CSV records.\n`);

  process.stdout.write(`Loading wix_redirects + posts caches...\n`);
  const caches = await loadResolverCaches();
  process.stdout.write(
    `Caches: ${caches.redirects.size} redirects, ${caches.postSlugs.size} post slugs.\n`,
  );

  const prepared = prepareRows(rows, caches);
  const sessionCount = prepared.sessions.length;
  const pageviewCount = prepared.pageviews.length;
  const unmappedCount = prepared.unmapped.size;
  const totalLegacyPageviews = prepared.pageviews.reduce((acc, p) => acc + p.pageviewCount, 0);
  process.stdout.write(
    [
      `\nSummary:`,
      `  date range:    ${prepared.rangeFrom?.toISOString() ?? "?"} → ${prepared.rangeTo?.toISOString() ?? "?"}`,
      `  rows:          ${prepared.rowCount}`,
      `  sessions:      ${sessionCount}`,
      `  pageview rows: ${pageviewCount}`,
      `  pageviews Σ:   ${totalLegacyPageviews}`,
      `  unmapped paths: ${unmappedCount}`,
      "",
    ].join("\n"),
  );

  if (unmappedCount > 0) {
    const top = [...prepared.unmapped.entries()]
      .sort((a, b) => b[1].pageviews - a[1].pageviews)
      .slice(0, 10);
    process.stdout.write(`Top 10 unmapped paths:\n`);
    for (const [p, info] of top) {
      process.stdout.write(`  ${info.pageviews.toString().padStart(6)}  ${p}\n`);
    }
    process.stdout.write("\n");
  }

  if (args.dryRun) {
    process.stdout.write(`Dry run — no DB writes.\n`);
    return;
  }

  const sha = fileSha256(absPath);
  const result = await writeBatch(args, prepared, {
    sourceFile: path.basename(absPath),
    sourceFileSha256: sha,
  });
  process.stdout.write(
    [
      `\nWrite complete:`,
      `  batch id:         ${result.batchId}`,
      `  sessions added:   ${result.sessionsInserted}`,
      `  pageviews added:  ${result.pageviewsInserted}`,
      `  post_views added: ${result.postViewsInserted}`,
      `  unmapped tracked: ${result.unmappedInserted}`,
      "",
    ].join("\n"),
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`Importer failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
