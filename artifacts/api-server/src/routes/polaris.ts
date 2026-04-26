import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  polarisEpisodesTable,
  collateralTable,
  siteSettingsTable,
  ARTIFACT_STATUSES,
  type PolarisEpisode,
} from "@workspace/db";
import { canonicalUrlForCollateral } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { toSlug } from "../lib/slug";
import { previewFromFeed, importFromFeed } from "../lib/polarisLibsyn";
import { siteOrigin } from "../lib/siteOrigin";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

function absoluteUrl(url: string | null | undefined, origin: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await db.query.polarisEpisodesTable.findFirst({
      where: excludeId
        ? and(eq(polarisEpisodesTable.slug, slug), ne(polarisEpisodesTable.id, excludeId))
        : eq(polarisEpisodesTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

function serialize(e: PolarisEpisode) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    episodeNumber: e.episodeNumber,
    summary: e.summary,
    guestName: e.guestName,
    audioUrl: e.audioUrl,
    appleUrl: e.appleUrl,
    spotifyUrl: e.spotifyUrl,
    durationSeconds: e.durationSeconds,
    transcriptHtml: e.transcriptHtml,
    artworkUrl: e.artworkUrl,
    status: e.status,
    publishedAt: e.publishedAt,
    unpublishedAt: e.unpublishedAt,
    featured: e.featured,
    featuredRank: e.featuredRank,
    seoTitle: e.seoTitle,
    seoDescription: e.seoDescription,
    ogImage: e.ogImage,
    active: e.active,
    sourceId: e.sourceId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function publicFilterSql() {
  const now = new Date();
  return [
    eq(polarisEpisodesTable.active, true),
    eq(polarisEpisodesTable.status, "published"),
    sql`${polarisEpisodesTable.deletedAt} is null`,
    sql`(${polarisEpisodesTable.publishedAt} is null or ${polarisEpisodesTable.publishedAt} <= ${now})`,
    sql`(${polarisEpisodesTable.unpublishedAt} is null or ${polarisEpisodesTable.unpublishedAt} > ${now})`,
  ];
}

// ----- Public ------------------------------------------------------------

router.get("/polaris/episodes", async (req, res) => {
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = and(...publicFilterSql());

  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(polarisEpisodesTable)
    .where(where);

  const rows = await db
    .select()
    .from(polarisEpisodesTable)
    .where(where)
    .orderBy(desc(polarisEpisodesTable.publishedAt), desc(polarisEpisodesTable.episodeNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({
    total: countRow?.count ?? 0,
    page,
    pageSize,
    items: rows.map(serialize),
  });
});

router.get("/polaris/episodes/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.polarisEpisodesTable.findFirst({
    where: and(eq(polarisEpisodesTable.slug, slug), ...publicFilterSql()),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// RSS 2.0 feed with iTunes namespace extensions so the show can be submitted
// to Apple / Spotify / Amazon Music directly from `/polaris/rss.xml`. Mounted
// at the API router so it resolves at /api/polaris/rss.xml; a site-root alias
// is added in app.ts for the canonical /polaris/rss.xml URL.
export async function handlePolarisRss(
  _req: import("express").Request,
  res: import("express").Response,
) {
  const rows = await db
    .select()
    .from(polarisEpisodesTable)
    .where(and(...publicFilterSql()))
    .orderBy(desc(polarisEpisodesTable.publishedAt), desc(polarisEpisodesTable.episodeNumber))
    .limit(200);

  const origin = siteOrigin();
  const channelTitle = "Polaris Pathways — A Synozur Podcast";
  const channelDescription =
    "Polaris Pathways charts the course for business, leadership and technology transformation.";
  const channelImage = `${origin}/images/polaris/show.jpg`;
  const channelLink = `${origin}/polaris`;
  const lastBuild = new Date().toUTCString();

  const items = rows
    .map((ep) => {
      const guid = `${origin}/polaris/${ep.slug}`;
      const pubDate = ep.publishedAt
        ? ep.publishedAt.toUTCString()
        : ep.createdAt.toUTCString();
      const duration = ep.durationSeconds
        ? formatDuration(ep.durationSeconds)
        : null;
      const enclosureLength = 0; // Unknown until the file is HEAD-checked.
      return [
        "    <item>",
        `      <title>${xmlEscape(ep.title)}</title>`,
        `      <link>${xmlEscape(guid)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(guid)}</guid>`,
        `      <description>${xmlEscape(ep.summary || "")}</description>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <itunes:episode>${ep.episodeNumber}</itunes:episode>`,
        `      <itunes:summary>${xmlEscape(ep.summary || "")}</itunes:summary>`,
        ep.guestName
          ? `      <itunes:author>${xmlEscape(ep.guestName)}</itunes:author>`
          : "",
        duration ? `      <itunes:duration>${duration}</itunes:duration>` : "",
        ep.artworkUrl
          ? `      <itunes:image href="${xmlEscape(absoluteUrl(ep.artworkUrl, origin))}"/>`
          : "",
        ep.audioUrl
          ? `      <enclosure url="${xmlEscape(absoluteUrl(ep.audioUrl, origin))}" length="${enclosureLength}" type="audio/mpeg"/>`
          : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    '  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"',
    '  xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "  <channel>",
    `    <title>${xmlEscape(channelTitle)}</title>`,
    `    <link>${xmlEscape(channelLink)}</link>`,
    "    <language>en-us</language>",
    `    <description>${xmlEscape(channelDescription)}</description>`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    "    <itunes:type>episodic</itunes:type>",
    '    <itunes:category text="Business"/>',
    '    <itunes:category text="Technology"/>',
    `    <itunes:image href="${xmlEscape(channelImage)}"/>`,
    "    <itunes:explicit>false</itunes:explicit>",
    "    <itunes:author>Synozur</itunes:author>",
    "    <itunes:owner>",
    "      <itunes:name>Synozur</itunes:name>",
    "      <itunes:email>polaris@synozur.com</itunes:email>",
    "    </itunes:owner>",
    items,
    "  </channel>",
    "</rss>",
  ].join("\n");

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).send(xml);
}

router.get("/polaris/rss.xml", handlePolarisRss);

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// ----- Admin -------------------------------------------------------------

const EpisodeBody = z.object({
  slug: z.string().nullish(),
  title: z.string().min(1),
  episodeNumber: z.number().int(),
  summary: z.string().optional(),
  guestName: z.string().nullish(),
  audioUrl: z.string().optional(),
  appleUrl: z.string().nullish(),
  spotifyUrl: z.string().nullish(),
  durationSeconds: z.number().int().nullish(),
  transcriptHtml: z.string().nullish(),
  artworkUrl: z.string().optional(),
  status: z.enum(ARTIFACT_STATUSES).optional(),
  publishedAt: z.string().nullish(),
  unpublishedAt: z.string().nullish(),
  featured: z.boolean().optional(),
  featuredRank: z.number().int().nullish(),
  seoTitle: z.string().nullish(),
  seoDescription: z.string().nullish(),
  ogImage: z.string().nullish(),
  active: z.boolean().optional(),
  sourceId: z.string().nullish(),
});
const EpisodePatch = EpisodeBody.partial();

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/cms/polaris/episodes", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(polarisEpisodesTable)
    .where(sql`${polarisEpisodesTable.deletedAt} is null`)
    .orderBy(desc(polarisEpisodesTable.episodeNumber));
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/polaris/episodes/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.polarisEpisodesTable.findFirst({
    where: eq(polarisEpisodesTable.id, id),
  });
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/polaris/episodes", ...adminGuard, async (req, res) => {
  const parsed = EpisodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(d.slug || d.title);
  const [row] = await db
    .insert(polarisEpisodesTable)
    .values({
      slug,
      title: d.title,
      episodeNumber: d.episodeNumber,
      summary: d.summary ?? "",
      guestName: d.guestName ?? null,
      audioUrl: d.audioUrl ?? "",
      appleUrl: d.appleUrl ?? null,
      spotifyUrl: d.spotifyUrl ?? null,
      durationSeconds: d.durationSeconds ?? null,
      transcriptHtml: d.transcriptHtml ?? null,
      artworkUrl: d.artworkUrl ?? "",
      status: d.status ?? "draft",
      publishedAt: parseDate(d.publishedAt),
      unpublishedAt: parseDate(d.unpublishedAt),
      featured: d.featured ?? false,
      featuredRank: d.featuredRank ?? null,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
      ogImage: d.ogImage ?? null,
      active: d.active ?? true,
      sourceId: d.sourceId ?? null,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "polaris_episode.create",
    entity: "polaris_episode",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/polaris/episodes/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.polarisEpisodesTable.findFirst({
    where: eq(polarisEpisodesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = EpisodePatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.slug !== undefined && d.slug !== null) {
    updates.slug = await ensureUniqueSlug(d.slug, id);
  }
  for (const k of [
    "title",
    "episodeNumber",
    "summary",
    "guestName",
    "audioUrl",
    "appleUrl",
    "spotifyUrl",
    "durationSeconds",
    "transcriptHtml",
    "artworkUrl",
    "status",
    "featured",
    "featuredRank",
    "seoTitle",
    "seoDescription",
    "ogImage",
    "active",
    "sourceId",
  ] as const) {
    if (d[k] !== undefined) updates[k] = d[k];
  }
  if (d.publishedAt !== undefined) updates.publishedAt = parseDate(d.publishedAt);
  if (d.unpublishedAt !== undefined) updates.unpublishedAt = parseDate(d.unpublishedAt);

  const [updated] = await db
    .update(polarisEpisodesTable)
    .set(updates)
    .where(eq(polarisEpisodesTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "polaris_episode.update",
    entity: "polaris_episode",
    entityId: id,
  });
  res.json(serialize(updated));
});

// ----- Libsyn ingestion (#113) ------------------------------------------

async function resolveFeedUrl(override?: string | null): Promise<string | null> {
  if (override && override.trim().length > 0) return override.trim();
  const [row] = await db
    .select({ polarisFeedUrl: siteSettingsTable.polarisFeedUrl })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  const url = row?.polarisFeedUrl ?? null;
  return url && url.trim().length > 0 ? url.trim() : null;
}

const ImportBody = z.object({
  guids: z.array(z.string().min(1)).min(1),
  allowResync: z.boolean().optional(),
  feedUrl: z.string().url().optional(),
});

const PreviewQuery = z.object({
  feedUrl: z.string().url().optional(),
});

router.get("/cms/polaris/libsyn/preview", ...adminGuard, async (req, res) => {
  const parsedQuery = PreviewQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      error: "Invalid query",
      details: parsedQuery.error.flatten(),
    });
    return;
  }
  const feedUrl = await resolveFeedUrl(parsedQuery.data.feedUrl ?? null);
  if (!feedUrl) {
    res.status(400).json({
      error:
        "Polaris feed URL is not configured. Set it in site settings or pass feedUrl query param.",
    });
    return;
  }
  try {
    const items = await previewFromFeed(feedUrl);
    res.json({ feedUrl, items });
  } catch (err) {
    res.status(502).json({
      error: "Failed to fetch or parse feed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/cms/polaris/libsyn/import", ...adminGuard, async (req, res) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const feedUrl = await resolveFeedUrl(parsed.data.feedUrl);
  if (!feedUrl) {
    res.status(400).json({
      error: "Polaris feed URL is not configured. Set it in site settings first.",
    });
    return;
  }
  try {
    const summary = await importFromFeed(feedUrl, parsed.data.guids, {
      allowResync: parsed.data.allowResync ?? false,
    });
    await audit({
      actorId: req.authedUser!.id,
      action: "polaris_episode.libsyn_import",
      entity: "polaris_episode",
      entityId: null,
      diff: {
        feedUrl,
        requested: parsed.data.guids.length,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        errors: summary.errors.length,
      },
    });
    res.json(summary);
  } catch (err) {
    res.status(502).json({
      error: "Import failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.delete("/cms/polaris/episodes/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.polarisEpisodesTable.findFirst({
    where: eq(polarisEpisodesTable.id, id),
  });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const now = new Date();
  await db
    .update(polarisEpisodesTable)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(polarisEpisodesTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "polaris_episode.delete",
    entity: "polaris_episode",
    entityId: id,
  });
  res.status(204).end();
});

// ----- Collateral Library sync (#sync) -----------------------------------
// Each episode can be linked to at most one collateral entry (type=podcast).
// The link is tracked via collateral.polaris_episode_id. All three actions
// are idempotent and safe to retry.

function serializeCollateralLink(row: typeof collateralTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    featured: row.featured,
    featuredRank: row.featuredRank ?? null,
    active: row.active,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString().split("T")[0] : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET  /cms/polaris/episodes/:id/collateral — returns the linked collateral
// entry (or null) so the editor can show current sync status.
router.get("/cms/polaris/episodes/:id/collateral", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const episode = await db.query.polarisEpisodesTable.findFirst({
    where: eq(polarisEpisodesTable.id, id),
  });
  if (!episode || episode.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const linked = await db.query.collateralTable.findFirst({
    where: and(
      eq(collateralTable.polarisEpisodeId, id),
      isNull(collateralTable.deletedAt),
    ),
  });
  res.json({ collateral: linked ? serializeCollateralLink(linked) : null });
});

// POST /cms/polaris/episodes/:id/sync-collateral — creates or re-syncs the
// linked collateral entry using the episode's current fields. Preserves the
// slug on update so public URLs don't break. Featured / featuredRank flow
// from the episode's own flags so the home carousel can be driven from the
// episode editor.
router.post(
  "/cms/polaris/episodes/:id/sync-collateral",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const episode = await db.query.polarisEpisodesTable.findFirst({
      where: eq(polarisEpisodesTable.id, id),
    });
    if (!episode || episode.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const existing = await db.query.collateralTable.findFirst({
      where: and(
        eq(collateralTable.polarisEpisodeId, id),
        isNull(collateralTable.deletedAt),
      ),
    });

    const syncFields = {
      title: episode.title,
      description: episode.summary || "",
      heroImage: episode.artworkUrl || "",
      url: canonicalUrlForCollateral("podcast", episode.slug),
      external: false,
      publishedAt: episode.publishedAt,
      active: episode.active,
      featured: episode.featured,
      featuredRank: episode.featuredRank ?? null,
      sourceId: `polaris_episode:${id}`,
      updatedAt: new Date(),
    };

    let row: typeof collateralTable.$inferSelect;

    if (existing) {
      const [updated] = await db
        .update(collateralTable)
        .set(syncFields)
        .where(eq(collateralTable.id, existing.id))
        .returning();
      row = updated;
      await audit({
        actorId: req.authedUser!.id,
        action: "polaris_episode.collateral_sync",
        entity: "collateral",
        entityId: existing.id,
        diff: { episodeId: id },
      });
    } else {
      const slug = await (async () => {
        const base = toSlug(`polaris-${episode.slug}`);
        let candidate = base;
        let i = 1;
        while (true) {
          const conflict = await db.query.collateralTable.findFirst({
            where: eq(collateralTable.slug, candidate),
          });
          if (!conflict) return candidate;
          i++;
          candidate = `${base}-${i}`;
        }
      })();

      const [created] = await db
        .insert(collateralTable)
        .values({
          slug,
          type: "podcast",
          polarisEpisodeId: id,
          ...syncFields,
          tags: [],
          subtitle: episode.guestName ?? null,
          pillar: null,
          videoUrl: null,
          downloadUrl: null,
          serviceId: null,
          solutionId: null,
        })
        .returning();
      row = created;
      await audit({
        actorId: req.authedUser!.id,
        action: "polaris_episode.collateral_add",
        entity: "collateral",
        entityId: created.id,
        diff: { episodeId: id },
      });
    }

    res.json({ collateral: serializeCollateralLink(row) });
  },
);

// DELETE /cms/polaris/episodes/:id/sync-collateral — soft-deletes the linked
// collateral entry. The polaris_episode_id FK stays set so the record can be
// inspected in the audit log; the null deletedAt check above keeps it hidden
// from all public and admin list queries.
router.delete(
  "/cms/polaris/episodes/:id/sync-collateral",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const episode = await db.query.polarisEpisodesTable.findFirst({
      where: eq(polarisEpisodesTable.id, id),
    });
    if (!episode || episode.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const existing = await db.query.collateralTable.findFirst({
      where: and(
        eq(collateralTable.polarisEpisodeId, id),
        isNull(collateralTable.deletedAt),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "No linked collateral entry" });
      return;
    }

    const now = new Date();
    await db
      .update(collateralTable)
      .set({ deletedAt: now, active: false, updatedAt: now })
      .where(eq(collateralTable.id, existing.id));
    await audit({
      actorId: req.authedUser!.id,
      action: "polaris_episode.collateral_remove",
      entity: "collateral",
      entityId: existing.id,
      diff: { episodeId: id },
    });

    res.status(204).end();
  },
);

export default router;
