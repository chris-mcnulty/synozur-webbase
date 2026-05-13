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
  servicesTable,
  solutionsTable,
  applicationsTable,
  modelsTable,
  workshopsTable,
  teamMembersTable,
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
  "service",
  "solution",
  "application",
  "model",
  "workshop",
  "team-member",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^[1-9][0-9]{0,9}$/;

// Team members use a `serial` (integer) primary key; every other OG kind
// uses uuid. Validate per-kind so a `team-member` request can pass an
// integer id without us widening the regex for everything else.
function isValidIdForKind(kind: OgImageKind, id: string): boolean {
  if (kind === "team-member") return INT_RE.test(id);
  return UUID_RE.test(id);
}

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

    case "service": {
      const [row] = await db
        .select({
          id: servicesTable.id,
          title: servicesTable.title,
          seoTitle: servicesTable.seoTitle,
          updatedAt: servicesTable.updatedAt,
        })
        .from(servicesTable)
        .where(and(eq(servicesTable.id, id), isNull(servicesTable.deletedAt)))
        .limit(1);
      if (!row) return null;
      return {
        input: { kind, title: row.seoTitle || row.title, byline: null, context: null },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "solution": {
      const [row] = await db
        .select({
          id: solutionsTable.id,
          title: solutionsTable.title,
          seoTitle: solutionsTable.seoTitle,
          updatedAt: solutionsTable.updatedAt,
        })
        .from(solutionsTable)
        .where(and(eq(solutionsTable.id, id), isNull(solutionsTable.deletedAt)))
        .limit(1);
      if (!row) return null;
      return {
        input: { kind, title: row.seoTitle || row.title, byline: null, context: null },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "application": {
      const [row] = await db
        .select({
          id: applicationsTable.id,
          name: applicationsTable.name,
          title: applicationsTable.title,
          tagline: applicationsTable.tagline,
          version: applicationsTable.version,
          updatedAt: applicationsTable.updatedAt,
        })
        .from(applicationsTable)
        .where(
          and(eq(applicationsTable.id, id), isNull(applicationsTable.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      const headline = row.name || row.title;
      const context =
        (row.tagline && row.tagline.trim()) ||
        (row.version ? `Version ${row.version}` : null);
      return {
        input: { kind, title: headline, byline: null, context: context || null },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "model": {
      const [row] = await db
        .select({
          id: modelsTable.id,
          title: modelsTable.title,
          shortDescription: modelsTable.shortDescription,
          updatedAt: modelsTable.updatedAt,
        })
        .from(modelsTable)
        .where(and(eq(modelsTable.id, id), isNull(modelsTable.deletedAt)))
        .limit(1);
      if (!row) return null;
      return {
        input: {
          kind,
          title: row.title,
          byline: null,
          context: (row.shortDescription && row.shortDescription.trim()) || null,
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "team-member": {
      const numericId = Number.parseInt(id, 10);
      if (!Number.isFinite(numericId)) return null;
      const [row] = await db
        .select({
          id: teamMembersTable.id,
          name: teamMembersTable.name,
          jobTitle: teamMembersTable.jobTitle,
          updatedAt: teamMembersTable.updatedAt,
          active: teamMembersTable.active,
        })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.id, numericId))
        .limit(1);
      if (!row || !row.active) return null;
      // Deliberately do NOT forward `team_members.image_url` as
      // `avatarUrl`. The renderer fetches `avatarUrl` server-side, and
      // the team-member headshot URL is editor-controlled — letting it
      // through would open an SSRF vector. The bio page already prefers
      // the editor headshot for og:image when it's set; this generator
      // path only fires when no headshot is configured, so the initials
      // disc is the intended fallback.
      return {
        input: {
          kind,
          title: row.name,
          byline: row.jobTitle || null,
          context: "Synozur Alliance",
        },
        lastModifiedMs: row.updatedAt.getTime(),
      };
    }

    case "workshop": {
      const [row] = await db
        .select({
          id: workshopsTable.id,
          title: workshopsTable.title,
          category: workshopsTable.category,
          shortDescription: workshopsTable.shortDescription,
          updatedAt: workshopsTable.updatedAt,
        })
        .from(workshopsTable)
        .where(and(eq(workshopsTable.id, id), isNull(workshopsTable.deletedAt)))
        .limit(1);
      if (!row) return null;
      const context =
        (row.category && row.category.trim()) ||
        (row.shortDescription && row.shortDescription.trim()) ||
        null;
      return {
        input: { kind, title: row.title, byline: null, context },
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
  const kind = rawKind as OgImageKind;
  if (!isValidIdForKind(kind, rawId)) {
    res.status(400).json({
      error:
        kind === "team-member"
          ? "Invalid or missing 'id' (must be a positive integer)"
          : "Invalid or missing 'id' (must be a UUID)",
    });
    return;
  }
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
const RegenerateBodySchema = z
  .object({
    kind: z.enum([
      "insight",
      "case-study",
      "white-paper",
      "polaris",
      "landing-page",
      "service",
      "solution",
      "application",
      "model",
      "workshop",
      "team-member",
    ]),
    id: z.string(),
    prerender: z.boolean().optional().default(false),
  })
  .refine((v) => isValidIdForKind(v.kind, v.id), {
    message: "Invalid id for kind (UUID for most kinds, integer for team-member)",
    path: ["id"],
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
