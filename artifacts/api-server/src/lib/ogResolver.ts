/**
 * Shared OG (Open Graph) data resolver.
 *
 * Looks up per-page title / description / image from the DB for any
 * front-end path and returns a typed OgData record.  Used by:
 *   - socialBotRenderer middleware (returns full HTML directly)
 *   - GET /api/og endpoint (returns HTML to be fetched by the SPA server)
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  postsTable,
  servicesTable,
  solutionsTable,
  caseStudiesTable,
  applicationsTable,
  modelsTable,
  workshopsTable,
  collateralTable,
  teamMembersTable,
  whitePapersTable,
  mediaTable,
  siteSettingsTable,
  polarisEpisodesTable,
} from "@workspace/db";
import { siteOrigin } from "./siteOrigin";

// ─── Public constants ─────────────────────────────────────────────────────────

export const SITE_NAME = "The Synozur Alliance";
export const DEFAULT_DESCRIPTION =
  "Strategy, AI, and Microsoft 365 advisory from The Synozur Alliance — practical guidance for leaders shaping the modern workplace.";
const DEFAULT_IMAGE_PATH = "/images/hero-bg.png";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OgData {
  title: string;
  description: string;
  image: string;
  ogType: "website" | "article";
  url: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function absUrl(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${origin}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

/**
 * Build the dynamic-OG-image URL for an artifact (#161). The endpoint
 * caches by `(kind, id, lastModified)`, so we encode the row's
 * `updated_at` epoch in a `v=` query param — this both busts upstream
 * caches when an editor saves a change and lets crawlers treat the URL
 * as immutable for as long as the artifact hasn't changed.
 */
export function dynamicOgImageUrl(
  kind: "insight" | "case-study" | "white-paper" | "polaris",
  id: string,
  lastModified: Date | null | undefined,
  origin: string,
): string {
  const v = lastModified ? lastModified.getTime() : 0;
  return `${origin}/api/og/image?kind=${kind}&id=${encodeURIComponent(id)}&v=${v}`;
}

async function resolveMediaUrl(
  mediaId: string | null | undefined,
  origin: string,
): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const [media] = await db
      .select({ publicUrl: mediaTable.publicUrl, storageKey: mediaTable.storageKey })
      .from(mediaTable)
      .where(eq(mediaTable.id, mediaId))
      .limit(1);
    if (!media) return null;
    if (media.publicUrl) return absUrl(media.publicUrl, origin);
    if (media.storageKey) return `${origin}/api/storage${media.storageKey}`;
    return null;
  } catch {
    return null;
  }
}

interface SiteDefaults {
  description: string;
  image: string;
}

async function loadSiteDefaults(origin: string): Promise<SiteDefaults> {
  try {
    const [row] = await db
      .select({
        seoDefaultDescription: siteSettingsTable.seoDefaultDescription,
        seoDefaultOgImageUrl: siteSettingsTable.seoDefaultOgImageUrl,
      })
      .from(siteSettingsTable)
      .limit(1);
    return {
      description: row?.seoDefaultDescription ?? DEFAULT_DESCRIPTION,
      image:
        row?.seoDefaultOgImageUrl ??
        absUrl(DEFAULT_IMAGE_PATH, origin) ??
        `${origin}${DEFAULT_IMAGE_PATH}`,
    };
  } catch {
    return {
      description: DEFAULT_DESCRIPTION,
      image: `${origin}${DEFAULT_IMAGE_PATH}`,
    };
  }
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Resolve OG metadata for the given frontend pathname.
 * Falls back gracefully to site defaults on missing content or DB errors.
 */
export async function resolveOgData(pathname: string): Promise<OgData> {
  const origin = siteOrigin();
  const defaults = await loadSiteDefaults(origin);

  const fallback: OgData = {
    title: SITE_NAME,
    description: defaults.description,
    image: defaults.image,
    ogType: "website",
    url: `${origin}${pathname}`,
  };

  const clean = pathname.replace(/\/+$/, "") || "/";
  const parts = clean.replace(/^\//, "").split("/");
  const section = parts[0] ?? "";
  const slug = parts[1] ?? "";

  if (!slug) return fallback;

  try {
    switch (section) {
      case "insights": {
        const [post] = await db
          .select({
            id: postsTable.id,
            title: postsTable.title,
            seoTitle: postsTable.seoTitle,
            excerpt: postsTable.excerpt,
            seoDescription: postsTable.seoDescription,
            ogImageId: postsTable.ogImageId,
            heroImageId: postsTable.heroImageId,
            updatedAt: postsTable.updatedAt,
          })
          .from(postsTable)
          .where(and(eq(postsTable.slug, slug), isNull(postsTable.deletedAt)))
          .limit(1);
        if (!post) break;
        const imgId = post.ogImageId ?? post.heroImageId;
        const img = await resolveMediaUrl(imgId, origin);
        return {
          title: post.seoTitle || post.title,
          description: post.seoDescription || post.excerpt || defaults.description,
          image:
            img ??
            dynamicOgImageUrl("insight", post.id, post.updatedAt, origin),
          ogType: "article",
          url: fallback.url,
        };
      }

      case "services": {
        const [row] = await db
          .select({
            title: servicesTable.title,
            seoTitle: servicesTable.seoTitle,
            seoDescription: servicesTable.seoDescription,
          })
          .from(servicesTable)
          .where(and(eq(servicesTable.slug, slug), isNull(servicesTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.seoTitle || row.title,
          description: row.seoDescription || defaults.description,
        };
      }

      case "solutions": {
        const [row] = await db
          .select({
            title: solutionsTable.title,
            seoTitle: solutionsTable.seoTitle,
            seoDescription: solutionsTable.seoDescription,
          })
          .from(solutionsTable)
          .where(and(eq(solutionsTable.slug, slug), isNull(solutionsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.seoTitle || row.title,
          description: row.seoDescription || defaults.description,
        };
      }

      case "case-studies": {
        const [row] = await db
          .select({
            id: caseStudiesTable.id,
            headline: caseStudiesTable.headline,
            summary: caseStudiesTable.summary,
            heroImage: caseStudiesTable.heroImage,
            ogImage: caseStudiesTable.ogImage,
            updatedAt: caseStudiesTable.updatedAt,
          })
          .from(caseStudiesTable)
          .where(and(eq(caseStudiesTable.slug, slug), isNull(caseStudiesTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const editorImage =
          (row.ogImage && row.ogImage.trim()) || (row.heroImage && row.heroImage.trim()) || null;
        return {
          ...fallback,
          title: row.headline || SITE_NAME,
          description: row.summary || defaults.description,
          image:
            absUrl(editorImage, origin) ??
            dynamicOgImageUrl("case-study", row.id, row.updatedAt, origin),
          ogType: "article",
        };
      }

      case "applications": {
        const [row] = await db
          .select({
            name: applicationsTable.name,
            shortSummary: applicationsTable.shortSummary,
            screenshot: applicationsTable.screenshot,
          })
          .from(applicationsTable)
          .where(and(eq(applicationsTable.slug, slug), isNull(applicationsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.name || SITE_NAME,
          description: row.shortSummary || defaults.description,
          image: absUrl(row.screenshot, origin) ?? defaults.image,
        };
      }

      case "models": {
        const [row] = await db
          .select({
            title: modelsTable.title,
            shortDescription: modelsTable.shortDescription,
            heroImage: modelsTable.heroImage,
          })
          .from(modelsTable)
          .where(and(eq(modelsTable.slug, slug), isNull(modelsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.title || SITE_NAME,
          description: row.shortDescription || defaults.description,
          image: absUrl(row.heroImage, origin) ?? defaults.image,
        };
      }

      case "workshops": {
        const [row] = await db
          .select({
            title: workshopsTable.title,
            shortDescription: workshopsTable.shortDescription,
            heroImage: workshopsTable.heroImage,
          })
          .from(workshopsTable)
          .where(and(eq(workshopsTable.slug, slug), isNull(workshopsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.title || SITE_NAME,
          description: row.shortDescription || defaults.description,
          image: absUrl(row.heroImage, origin) ?? defaults.image,
        };
      }

      case "library":
      case "webinars": {
        const [row] = await db
          .select({ title: collateralTable.title, heroImage: collateralTable.heroImage })
          .from(collateralTable)
          .where(and(eq(collateralTable.slug, slug), isNull(collateralTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.title || SITE_NAME,
          image: absUrl(row.heroImage, origin) ?? defaults.image,
        };
      }

      case "white-papers": {
        const [row] = await db
          .select({
            id: whitePapersTable.id,
            title: whitePapersTable.title,
            shortDescription: whitePapersTable.shortDescription,
            heroImage: whitePapersTable.heroImage,
            ogImage: whitePapersTable.ogImage,
            updatedAt: whitePapersTable.updatedAt,
          })
          .from(whitePapersTable)
          .where(and(eq(whitePapersTable.slug, slug), isNull(whitePapersTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const editorImage =
          (row.ogImage && row.ogImage.trim()) || (row.heroImage && row.heroImage.trim()) || null;
        return {
          ...fallback,
          title: row.title || SITE_NAME,
          description: row.shortDescription || defaults.description,
          image:
            absUrl(editorImage, origin) ??
            dynamicOgImageUrl("white-paper", row.id, row.updatedAt, origin),
        };
      }

      case "polaris": {
        const [row] = await db
          .select({
            id: polarisEpisodesTable.id,
            title: polarisEpisodesTable.title,
            seoTitle: polarisEpisodesTable.seoTitle,
            summary: polarisEpisodesTable.summary,
            seoDescription: polarisEpisodesTable.seoDescription,
            artworkUrl: polarisEpisodesTable.artworkUrl,
            ogImage: polarisEpisodesTable.ogImage,
            updatedAt: polarisEpisodesTable.updatedAt,
          })
          .from(polarisEpisodesTable)
          .where(
            and(
              eq(polarisEpisodesTable.slug, slug),
              isNull(polarisEpisodesTable.deletedAt),
            ),
          )
          .limit(1);
        if (!row) break;
        const editorImage =
          (row.ogImage && row.ogImage.trim()) ||
          (row.artworkUrl && row.artworkUrl.trim()) ||
          null;
        return {
          ...fallback,
          title: row.seoTitle || row.title,
          description:
            row.seoDescription || row.summary || defaults.description,
          image:
            absUrl(editorImage, origin) ??
            dynamicOgImageUrl("polaris", row.id, row.updatedAt, origin),
          ogType: "article",
        };
      }

      case "team": {
        const [row] = await db
          .select({ name: teamMembersTable.name, jobTitle: teamMembersTable.jobTitle })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.slug, slug))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: `${row.name} | The Synozur Alliance`,
          description: row.jobTitle
            ? `${row.name} — ${row.jobTitle} at The Synozur Alliance.`
            : defaults.description,
        };
      }

      default:
        break;
    }
  } catch {
    // DB error — fall through to site defaults.
  }

  return fallback;
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

export function renderOgHtml(og: OgData): string {
  const t = htmlEscape(og.title);
  const d = htmlEscape(og.description);
  const img = htmlEscape(og.image);
  const url = htmlEscape(og.url);
  const sn = htmlEscape(SITE_NAME);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="${og.ogType}" />
<meta property="og:site_name" content="${sn}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:image" content="${img}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
<link rel="canonical" href="${url}" />
</head>
<body>
<p><a href="${url}">${t}</a></p>
<p>${d}</p>
</body>
</html>`;
}
