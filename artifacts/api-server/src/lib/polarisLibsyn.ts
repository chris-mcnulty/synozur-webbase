import { and, eq, sql, inArray } from "drizzle-orm";
import { db, polarisEpisodesTable, type PolarisEpisode } from "@workspace/db";
import { toSlug } from "./slug";

// Libsyn RSS ingestion for the Polaris podcast. The feed URL is stored in
// site_settings.polarisFeedUrl; preview + import endpoints on the polaris
// router consume this module.

export interface LibsynItem {
  guid: string;
  title: string;
  episodeNumber: number | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  audioUrl: string;
  artworkUrl: string | null;
  summary: string;
  link: string | null;
}

export interface PreviewItem extends LibsynItem {
  existsInDb: boolean;
  existingId: string | null;
  existingEpisodeNumber: number | null;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ guid: string; message: string }>;
}

// -- RSS parsing ----------------------------------------------------------

function stripCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (m ? m[1] : s).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function pickTag(block: string, tag: string): string | null {
  // Matches <tag>...</tag> or <tag attr="x">...</tag> (non-greedy, case-sensitive).
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1]));
}

function pickAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function htmlToPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDuration(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function parsePubDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEpisodeNumber(explicit: string | null, title: string): number | null {
  if (explicit && /^\d+$/.test(explicit.trim())) return Number(explicit.trim());
  // Fallback patterns seen in Libsyn titles: "Ep 53: ...", "Episode 53 — ...",
  // "#53 ...", "Polaris 033 – ...".
  const patterns: RegExp[] = [
    /\b[Ee]p(?:isode)?\.?\s*#?(\d{1,4})\b/,
    /#(\d{1,4})\b/,
    /\b[Pp]olaris\s+0*(\d{1,4})\b/,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseLibsynRss(xml: string): LibsynItem[] {
  const items: LibsynItem[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const blocks = xml.match(itemRe) ?? [];
  for (const block of blocks) {
    const title = pickTag(block, "title") ?? "";
    const rawGuid = pickTag(block, "guid");
    const audioUrl = (pickAttr(block, "enclosure", "url") ?? "").trim();
    const guid = (rawGuid && rawGuid.length > 0 ? rawGuid : audioUrl).trim();
    if (!audioUrl) {
      console.warn(
        `[polarisLibsyn] Skipping RSS item with missing or empty enclosure url${guid ? ` (guid: ${guid})` : ""}${title ? ` (title: ${title})` : ""}.`,
      );
      continue;
    }
    if (!guid) continue;
    const episodeNumber = parseEpisodeNumber(
      pickTag(block, "itunes:episode"),
      title,
    );
    const durationSeconds = parseDuration(pickTag(block, "itunes:duration"));
    const publishedAt = parsePubDate(pickTag(block, "pubDate"));
    const artworkUrl = pickAttr(block, "itunes:image", "href");
    const summaryRaw =
      pickTag(block, "itunes:summary") ??
      pickTag(block, "description") ??
      "";
    const summary = htmlToPlainText(summaryRaw);
    const link = pickTag(block, "link");
    items.push({
      guid,
      title,
      episodeNumber,
      publishedAt,
      durationSeconds,
      audioUrl,
      artworkUrl,
      summary,
      link,
    });
  }
  return items;
}

// -- Feed fetch -----------------------------------------------------------

export async function fetchLibsynFeed(feedUrl: string): Promise<LibsynItem[]> {
  const timeoutMs = 10_000;

  try {
    const res = await fetch(feedUrl, {
      headers: { "user-agent": "synozur-polaris-ingest/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Feed fetch failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    return parseLibsynRss(xml);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(`Feed fetch timed out after ${timeoutMs}ms: ${feedUrl}`);
    }
    throw error;
  }
}

// -- Idempotency ---------------------------------------------------------

// Source-id helpers. The seed script used `libsyn:${episodeNumber}` as
// sourceId; new rows use `libsyn:guid:${guid}`. We match both so the 3 seeded
// rows aren't re-imported as duplicates.
export function sourceIdForGuid(guid: string): string {
  return `libsyn:guid:${guid}`;
}
function sourceIdForEpisodeNumber(n: number): string {
  return `libsyn:${n}`;
}

async function findExistingRows(
  items: LibsynItem[],
): Promise<Map<string, PolarisEpisode>> {
  const guidSourceIds = items.map((i) => sourceIdForGuid(i.guid));
  const numberSourceIds = items
    .map((i) => i.episodeNumber)
    .filter((n): n is number => typeof n === "number")
    .map(sourceIdForEpisodeNumber);
  const allIds = [...guidSourceIds, ...numberSourceIds];
  if (allIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(polarisEpisodesTable)
    .where(
      and(
        inArray(polarisEpisodesTable.sourceId, allIds),
        sql`${polarisEpisodesTable.deletedAt} is null`,
      ),
    );
  // Index by both sourceId forms so lookup by guid or by episode number works.
  const byKey = new Map<string, PolarisEpisode>();
  for (const row of rows) {
    if (row.sourceId) byKey.set(row.sourceId, row);
  }
  return byKey;
}

function matchExisting(
  item: LibsynItem,
  byKey: Map<string, PolarisEpisode>,
): PolarisEpisode | null {
  const guidHit = byKey.get(sourceIdForGuid(item.guid));
  if (guidHit) return guidHit;
  if (typeof item.episodeNumber === "number") {
    const legacyHit = byKey.get(sourceIdForEpisodeNumber(item.episodeNumber));
    if (legacyHit) return legacyHit;
  }
  return null;
}

// -- Preview / import -----------------------------------------------------

export async function previewFromFeed(feedUrl: string): Promise<PreviewItem[]> {
  const items = await fetchLibsynFeed(feedUrl);
  const byKey = await findExistingRows(items);
  return items.map((it) => {
    const existing = matchExisting(it, byKey);
    return {
      ...it,
      existsInDb: !!existing,
      existingId: existing?.id ?? null,
      existingEpisodeNumber: existing?.episodeNumber ?? null,
    };
  });
}

async function ensureUniqueSlug(
  base: string,
  excludeId: string | null,
): Promise<string> {
  const core = toSlug(base) || "episode";
  let slug = core;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.polarisEpisodesTable.findFirst({
      where: excludeId
        ? and(
            eq(polarisEpisodesTable.slug, slug),
            sql`${polarisEpisodesTable.id} <> ${excludeId}`,
          )
        : eq(polarisEpisodesTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${core}-${i}`;
  }
}

async function nextAutoEpisodeNumber(): Promise<number> {
  const [row] = await db
    .select({
      max: sql<number | null>`max(${polarisEpisodesTable.episodeNumber})`,
    })
    .from(polarisEpisodesTable);
  return (row?.max ?? 0) + 1;
}

export interface ImportOptions {
  // If true, re-import items that already exist in the DB (updates mutable
  // fields pulled from the feed). Items not in `guids` are always skipped.
  allowResync?: boolean;
}

export async function importFromFeed(
  feedUrl: string,
  selectedGuids: string[],
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };
  const want = new Set(selectedGuids);
  if (want.size === 0) return summary;

  const items = await fetchLibsynFeed(feedUrl);
  const selected = items.filter((i) => want.has(i.guid));
  const byKey = await findExistingRows(selected);

  for (const item of selected) {
    try {
      const existing = matchExisting(item, byKey);
      if (existing && !options.allowResync) {
        summary.skipped += 1;
        continue;
      }

      if (existing) {
        // Re-sync: only overwrite fields that come from the feed. Preserve
        // transcriptHtml, guestName, appleUrl, spotifyUrl, slug, status,
        // featured, seo*, and lifecycle flags.
        const updates: Partial<typeof polarisEpisodesTable.$inferInsert> = {
          title: item.title || existing.title,
          summary: item.summary || existing.summary,
          audioUrl: item.audioUrl || existing.audioUrl,
          artworkUrl: item.artworkUrl ?? existing.artworkUrl,
          durationSeconds: item.durationSeconds ?? existing.durationSeconds,
          publishedAt: item.publishedAt ?? existing.publishedAt,
          updatedAt: new Date(),
        };
        if (typeof item.episodeNumber === "number") {
          updates.episodeNumber = item.episodeNumber;
        }
        // Promote legacy `libsyn:${episodeNumber}` sourceId to guid form so
        // future runs match on the stable guid.
        updates.sourceId = sourceIdForGuid(item.guid);
        await db
          .update(polarisEpisodesTable)
          .set(updates)
          .where(eq(polarisEpisodesTable.id, existing.id));
        summary.updated += 1;
      } else {
        const episodeNumber =
          typeof item.episodeNumber === "number"
            ? item.episodeNumber
            : await nextAutoEpisodeNumber();
        const slug = await ensureUniqueSlug(item.title || `episode-${episodeNumber}`, null);
        await db.insert(polarisEpisodesTable).values({
          slug,
          title: item.title || `Episode ${episodeNumber}`,
          episodeNumber,
          summary: item.summary,
          audioUrl: item.audioUrl,
          artworkUrl: item.artworkUrl ?? "",
          durationSeconds: item.durationSeconds,
          publishedAt: item.publishedAt,
          status: "draft",
          active: true,
          sourceId: sourceIdForGuid(item.guid),
        });
        summary.created += 1;
      }
    } catch (err) {
      summary.errors.push({
        guid: item.guid,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Report selected guids that weren't present in the feed.
  const foundGuids = new Set(selected.map((i) => i.guid));
  for (const g of want) {
    if (!foundGuids.has(g)) {
      summary.errors.push({ guid: g, message: "Not found in feed" });
    }
  }

  return summary;
}
