/**
 * GET /api/og/image?kind=&id=
 *
 * Dynamic OG image generation for editorial content (#161 / launch-readiness L14).
 * Renders a 1200×630 PNG server-side from the brand template — used as a
 * fall-back when an artifact has no editor-set `ogImage`. Cached in object
 * storage keyed by `(kind, id, lastModified)` so repeated unfurls don't
 * re-render the SVG.
 *
 * Public endpoint — content is already public-readable elsewhere on the
 * site, and social crawlers (LinkedIn, Twitter, Slack, Discord) cannot
 * authenticate.
 */

import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  postsTable,
  caseStudiesTable,
  whitePapersTable,
  polarisEpisodesTable,
  landingPagesTable,
  usersTable,
} from "@workspace/db";
import {
  renderOgImagePng,
  type OgImageInput,
  type OgImageKind,
} from "../lib/ogImageRenderer";
import {
  clearCachedOgImage,
  readCachedOgImage,
  writeCachedOgImage,
} from "../lib/ogImageCache";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

const KINDS: readonly OgImageKind[] = [
  "insight",
  "case-study",
  "white-paper",
  "polaris",
  "landing-page",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedArtifact {
  input: OgImageInput;
  lastModifiedMs: number;
}

async function resolveArtifact(
  kind: OgImageKind,
  id: string,
): Promise<ResolvedArtifact | null> {
  switch (kind) {
    case "insight": {
      const [post] = await db
        .select({
          id: postsTable.id,
          title: postsTable.title,
          seoTitle: postsTable.seoTitle,
          authorId: postsTable.authorId,
          updatedAt: postsTable.updatedAt,
        })
        .from(postsTable)
        .where(and(eq(postsTable.id, id), isNull(postsTable.deletedAt)))
        .limit(1);
      if (!post) return null;
      let byline: string | null = null;
      let avatarUrl: string | null = null;
      if (post.authorId) {
        const [author] = await db
          .select({
            displayName: usersTable.displayName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(eq(usersTable.id, post.authorId))
          .limit(1);
        byline = author?.displayName ?? null;
        avatarUrl = author?.avatarUrl ?? null;
      }
      return {
        input: {
          kind,
          title: post.seoTitle || post.title,
          byline,
          avatarUrl,
          context: null,
        },
        lastModifiedMs: post.updatedAt.getTime(),
      };
    }

    case "case-study": {
      const [row] = await db
        .select({
          id: caseStudiesTable.id,
          title: caseStudiesTable.title,
          headline: caseStudiesTable.headline,
          clientLabel: caseStudiesTable.clientLabel,
          industry: caseStudiesTable.industry,
          updatedAt: caseStudiesTable.updatedAt,
        })
        .from(caseStudiesTable)
        .where(
          and(eq(caseStudiesTable.id, id), isNull(caseStudiesTable.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      const contextParts = [row.clientLabel, row.industry]
        .map((s) => (s ?? "").trim())
        .filter(Boolean);
      return {
        input: {
          kind,
          title: row.headline || row.title,
          byline: null,
          context: contextParts.join(" · ") || null,
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "white-paper": {
      const [row] = await db
        .select({
          id: whitePapersTable.id,
          title: whitePapersTable.title,
          subtitle: whitePapersTable.subtitle,
          docType: whitePapersTable.docType,
          updatedAt: whitePapersTable.updatedAt,
        })
        .from(whitePapersTable)
        .where(
          and(eq(whitePapersTable.id, id), isNull(whitePapersTable.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      // Capitalise the doc type for display ("whitepaper" → "Whitepaper").
      const docLabel =
        row.docType.charAt(0).toUpperCase() + row.docType.slice(1);
      return {
        input: {
          kind,
          title: row.title,
          byline: null,
          context: row.subtitle || docLabel,
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "polaris": {
      const [row] = await db
        .select({
          id: polarisEpisodesTable.id,
          title: polarisEpisodesTable.title,
          episodeNumber: polarisEpisodesTable.episodeNumber,
          guestName: polarisEpisodesTable.guestName,
          updatedAt: polarisEpisodesTable.updatedAt,
        })
        .from(polarisEpisodesTable)
        .where(
          and(
            eq(polarisEpisodesTable.id, id),
            isNull(polarisEpisodesTable.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        input: {
          kind,
          title: row.title,
          byline: row.guestName || null,
          context: `Episode ${row.episodeNumber}`,
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "landing-page": {
      const [row] = await db
        .select({
          id: landingPagesTable.id,
          title: landingPagesTable.title,
          seoTitle: landingPagesTable.seoTitle,
          subtitle: landingPagesTable.subtitle,
          updatedAt: landingPagesTable.updatedAt,
        })
        .from(landingPagesTable)
        .where(
          and(eq(landingPagesTable.id, id), isNull(landingPagesTable.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      return {
        input: {
          kind,
          title: row.seoTitle || row.title,
          byline: null,
          context: row.subtitle || null,
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    default:
      return null;
  }
}

router.get("/og/image", async (req, res): Promise<void> => {
  const rawKind = typeof req.query.kind === "string" ? req.query.kind : "";
  const rawId = typeof req.query.id === "string" ? req.query.id : "";

  if (!KINDS.includes(rawKind as OgImageKind)) {
    res.status(400).json({
      error: "Invalid or missing 'kind'",
      allowed: KINDS,
    });
    return;
  }
  if (!UUID_RE.test(rawId)) {
    res.status(400).json({ error: "Invalid or missing 'id' (must be a UUID)" });
    return;
  }

  const kind = rawKind as OgImageKind;
  const id = rawId;

  try {
    const resolved = await resolveArtifact(kind, id);
    if (!resolved) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    const cacheKey = {
      kind,
      id,
      lastModifiedMs: resolved.lastModifiedMs,
    };

    let png = await readCachedOgImage(cacheKey);
    let cacheStatus: "HIT" | "MISS" = "HIT";
    if (!png) {
      cacheStatus = "MISS";
      png = await renderOgImagePng(resolved.input);
      // Fire-and-forget write — never block the response on cache write.
      void writeCachedOgImage(cacheKey, png);
    }

    res.setHeader("Content-Type", "image/png");
    // Embedded `lastModifiedMs` is part of the URL via the upstream
    // og:image link, so caches are safe to keep this PNG for a long
    // time. Editorial bumps `updated_at` → URL changes → fresh fetch.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Og-Cache", cacheStatus);
    res.setHeader("Content-Length", String(png.length));
    res.end(png);
  } catch (err) {
    req.log?.error?.({ err, kind, id }, "OG image generation failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to render OG image",
    });
  }
});

/**
 * POST /api/og/regenerate
 *
 * Drops every cached PNG for `(kind, id)` and (when `prerender=true`)
 * renders a fresh one synchronously so the next unfurl is a HIT. Used
 * when the renderer template changes — same row, same `updated_at`,
 * but the bytes need to be regenerated.
 *
 * Admin/editor only. Returns `{ ok, kind, id, cleared, prerendered }`.
 */
const RegenerateBodySchema = z.object({
  kind: z.enum(["insight", "case-study", "white-paper", "polaris", "landing-page"]),
  id: z.string().uuid(),
  prerender: z.boolean().optional().default(false),
});

router.post(
  "/og/regenerate",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res): Promise<void> => {
    const parsed = RegenerateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { kind, id, prerender } = parsed.data;

    try {
      const clearResult = await clearCachedOgImage(kind, id);
      // Aggregate errors so a partial-failure (clear ok, write fails) is
      // still surfaced as 502 to operators rather than masked as success.
      const errors = [...clearResult.errors];

      let prerendered = false;
      if (prerender) {
        const resolved = await resolveArtifact(kind, id);
        if (!resolved) {
          res.status(404).json({ error: "Artifact not found" });
          return;
        }
        const png = await renderOgImagePng(resolved.input);
        const writeResult = await writeCachedOgImage(
          {
            kind,
            id,
            lastModifiedMs: resolved.lastModifiedMs,
          },
          png,
        );
        if (!writeResult.ok) {
          errors.push(`write: ${writeResult.error ?? "unknown"}`);
        }
        prerendered = true;
      }

      const ok = errors.length === 0;
      const status = ok ? 200 : 502;
      res.status(status).json({
        ok,
        kind,
        id,
        cleared: clearResult.cleared,
        storageConfigured: clearResult.storageConfigured,
        prerendered,
        ...(errors.length > 0 ? { errors } : {}),
      });
    } catch (err) {
      req.log?.error?.({ err, kind, id }, "OG image regenerate failed");
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to regenerate OG image",
      });
    }
  },
);

export default router;
