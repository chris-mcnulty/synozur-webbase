/**
 * Shared OG (Open Graph) data resolver.
 *
 * Looks up per-page title / description / image from the DB for any
 * front-end path and returns a typed OgData record.  Used by:
 *   - socialBotRenderer middleware (returns full HTML directly)
 *   - GET /api/og endpoint (returns HTML to be fetched by the SPA server)
 */

import { and, eq, isNull } from "drizzle-orm";
import { OG_TEMPLATE_VERSION } from "./ogImageRenderer";
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
  landingPagesTable,
  assetsTable,
} from "@workspace/db";
import { siteOrigin } from "./siteOrigin";

// ─── Public constants ─────────────────────────────────────────────────────────

export const SITE_NAME = "The Synozur Alliance";
export const DEFAULT_DESCRIPTION =
  "Strategy, AI, and Microsoft 365 advisory from The Synozur Alliance — practical guidance for leaders shaping the modern workplace.";
const DEFAULT_IMAGE_PATH = "/opengraph.jpg";

// ─── Static page OG registry ───────────────────────────────────────────────────

/**
 * Hardcoded SPA routes that are NOT DB-driven landing pages. Social crawlers
 * and search engines don't run JS, so they never see the per-page `<Meta>`
 * these pages render client-side. Mirror that copy here so the server-side OG
 * resolver returns page-specific title/description/image for crawlers.
 *
 * Keep each entry in sync with the corresponding page's `<Meta>` in
 * `artifacts/synozur/src/pages/*` (the source of truth). Titles use the exact
 * `rawTitle` string those pages declare (site name already included), so no
 * site-name suffix is appended here.
 */
interface StaticPageOg {
  title: string;
  description: string;
  /** Root-relative or absolute image path, matching the page's `<Meta image>`. */
  image: string;
}

const STATIC_PAGE_OG: Record<string, StaticPageOg> = {
  "/sprint": {
    title: "The AI & North Star Sprint — The Synozur Alliance",
    description:
      "A structured executive engagement that turns ambiguity into aligned decisions, a practical AI-first roadmap, and measurable next steps — in 4 to 6 weeks.",
    image: DEFAULT_IMAGE_PATH,
  },
  "/proof": {
    title: "Proof — Outcomes We Can Prove — The Synozur Alliance",
    description:
      "Anchor cases in Before / After / Impact form — from a Microsoft engagement to AI transformation in private equity. Measurable outcomes, not promises.",
    image: DEFAULT_IMAGE_PATH,
  },
  "/fit": {
    title: "Is the Sprint Right for You? — The Synozur Alliance",
    description:
      "The AI & North Star Sprint is most effective when leadership teams are ready to align on what matters. See where it creates the most value — and where it may not fit.",
    image: DEFAULT_IMAGE_PATH,
  },
  "/book": {
    title: "Book the Conversation — The Synozur Alliance",
    description:
      "Schedule a focused working conversation to understand your current context, where alignment may be breaking down, and whether the AI & North Star Sprint is the right next step.",
    image: DEFAULT_IMAGE_PATH,
  },
};

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

// Target width for OG share images. 1200px is the long edge most social
// platforms recommend (LinkedIn/Twitter render 1200×630). The storage
// route caps at 2048 and never enlarges, so smaller originals pass through
// untouched.
const OG_IMAGE_WIDTH = 1200;

// Storage paths the api-server can resize on the fly (the routes that flow
// through sharp). Mirrors `RESIZABLE_PATH_RE` in the synozur frontend's
// `lib/media-url.ts`. External hosts and static `/images/...` paths are
// excluded — appending `?w=`/`?fmt=` to them would be ignored at best.
const RESIZABLE_STORAGE_RE = /\/api\/storage\/(?:public-)?objects\//i;

/**
 * Point an OG image at a resized JPEG variant when it's a storage-backed
 * image the server can resize. The full-size original of a hero photo can
 * exceed LinkedIn's ~5 MB cap (and is wasteful for every unfurl); a 1200px
 * JPEG is typically a few hundred KB and renders reliably across LinkedIn,
 * Teams, Slack, and Twitter. URLs the server can't resize (external hosts,
 * the dynamic `/api/og/image` card, static assets) are returned unchanged.
 */
function ogImageVariant(url: string | null, origin: string): string | null {
  if (!url) return null;
  // Only rewrite our own storage URLs the api-server can actually resize.
  // An external absolute URL (even one that happens to contain the storage
  // path) is left untouched, matching the contract above. Every caller
  // resolves through `absUrl`/`${origin}...` first, so same-origin URLs are
  // the ones we built and can serve resized.
  if (!url.startsWith(origin) || !RESIZABLE_STORAGE_RE.test(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("w", String(OG_IMAGE_WIDTH));
    u.searchParams.set("fmt", "jpeg");
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}w=${OG_IMAGE_WIDTH}&fmt=jpeg`;
  }
}

/**
 * Build the dynamic-OG-image URL for an artifact (#161). Encodes two
 * cache-busting params so upstream caches (LinkedIn, Slack, browsers,
 * CDNs that honour `Cache-Control: immutable`) refetch when either
 * signal changes:
 *   - `v` — the row's `updated_at` epoch (per-row content bump).
 *   - `t` — `OG_TEMPLATE_VERSION` (global renderer-template bump).
 *
 * Crawlers can safely treat the URL as immutable for as long as the
 * artifact hasn't changed and the template version hasn't been bumped.
 */
export function dynamicOgImageUrl(
  kind:
    | "insight"
    | "case-study"
    | "white-paper"
    | "polaris"
    | "landing-page"
    | "service"
    | "solution"
    | "application"
    | "model"
    | "workshop",
  id: string,
  lastModified: Date | null | undefined,
  origin: string,
): string {
  const v = lastModified ? lastModified.getTime() : 0;
  return `${origin}/api/og/image?kind=${kind}&id=${encodeURIComponent(id)}&v=${v}&t=${OG_TEMPLATE_VERSION}`;
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
    if (media.publicUrl)
      return ogImageVariant(absUrl(media.publicUrl, origin), origin);
    if (media.storageKey)
      return ogImageVariant(`${origin}/api/storage${media.storageKey}`, origin);
    return null;
  } catch {
    return null;
  }
}

// Mirrors `imageUrlFor()` in `artifacts/api-server/src/routes/siteSettings.ts`
// for the legacy integer-id `assets` table. Resolves to the same
// `/api/storage/<storageKey>` URL the admin UI surfaces in the picker so
// the bot middleware sees the same image the editor configured. Drop
// alongside the legacy `assets` table when BACKLOG.md "Asset Library
// consolidation" §3 lands.
async function resolveAssetUrl(
  assetId: number | null | undefined,
  origin: string,
): Promise<string | null> {
  if (assetId == null) return null;
  try {
    const [asset] = await db
      .select({ storageKey: assetsTable.storageKey })
      .from(assetsTable)
      .where(eq(assetsTable.id, assetId))
      .limit(1);
    if (!asset?.storageKey) return null;
    return ogImageVariant(`${origin}/api/storage${asset.storageKey}`, origin);
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
        seoDefaultOgImageMediaId: siteSettingsTable.seoDefaultOgImageMediaId,
        seoDefaultOgImageAssetId: siteSettingsTable.seoDefaultOgImageAssetId,
      })
      .from(siteSettingsTable)
      .limit(1);
    const description = row?.seoDefaultDescription ?? DEFAULT_DESCRIPTION;
    // Mirrors the "prefer media, fall back to asset" precedence in
    // `routes/siteSettings.ts:resolveImageUrls()`. New writes flow through
    // `seoDefaultOgImageMediaId` (UUID → mediaTable), but the legacy
    // `seoDefaultOgImageAssetId` (integer → assetsTable) is still
    // populated until BACKLOG.md "Asset Library consolidation" §3 drops
    // the assets table — so production environments that configured the
    // default OG image before the media migration still resolve correctly.
    const configured =
      (await resolveMediaUrl(row?.seoDefaultOgImageMediaId, origin)) ??
      (await resolveAssetUrl(row?.seoDefaultOgImageAssetId, origin));
    return {
      description,
      image:
        configured ??
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

  // Single-segment path (no sub-slug) — landing pages live at /:slug.
  // All other registered routes have two segments (e.g. /insights/:slug),
  // so if slug is empty but section is non-empty we try the landing pages
  // table before falling back to site defaults.
  if (!slug) {
    // Hardcoded SPA routes (not DB landing pages) — return their known
    // per-page OG data so crawlers see real title/description/image instead
    // of the generic site default. All other single-segment paths fall
    // through to the landing-pages lookup and site defaults unchanged.
    const staticOg = STATIC_PAGE_OG[clean];
    if (staticOg) {
      return {
        ...fallback,
        title: staticOg.title,
        description: staticOg.description,
        image:
          ogImageVariant(absUrl(staticOg.image, origin), origin) ??
          fallback.image,
        ogType: "website",
      };
    }
    if (section) {
      try {
        const [row] = await db
          .select({
            id: landingPagesTable.id,
            title: landingPagesTable.title,
            seoTitle: landingPagesTable.seoTitle,
            seoDescription: landingPagesTable.seoDescription,
            ogImageUrl: landingPagesTable.ogImageUrl,
            heroImage: landingPagesTable.heroImage,
            updatedAt: landingPagesTable.updatedAt,
          })
          .from(landingPagesTable)
          .where(
            and(
              eq(landingPagesTable.slug, section),
              eq(landingPagesTable.status, "published"),
              isNull(landingPagesTable.deletedAt),
            ),
          )
          .limit(1);
        if (row) {
          const editorImage =
            (row.ogImageUrl && row.ogImageUrl.trim()) ||
            (row.heroImage && row.heroImage.trim()) ||
            null;
          return {
            ...fallback,
            title: row.seoTitle || row.title,
            description: row.seoDescription || defaults.description,
            image:
              ogImageVariant(absUrl(editorImage, origin), origin) ??
              dynamicOgImageUrl("landing-page", row.id, row.updatedAt, origin),
            ogType: "website",
          };
        }
      } catch {
        // DB error — fall through to site defaults.
      }
    }
    return fallback;
  }

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
            id: servicesTable.id,
            title: servicesTable.title,
            seoTitle: servicesTable.seoTitle,
            seoDescription: servicesTable.seoDescription,
            updatedAt: servicesTable.updatedAt,
          })
          .from(servicesTable)
          .where(and(eq(servicesTable.slug, slug), isNull(servicesTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.seoTitle || row.title,
          description: row.seoDescription || defaults.description,
          image: dynamicOgImageUrl("service", row.id, row.updatedAt, origin),
        };
      }

      case "solutions": {
        const [row] = await db
          .select({
            id: solutionsTable.id,
            title: solutionsTable.title,
            seoTitle: solutionsTable.seoTitle,
            seoDescription: solutionsTable.seoDescription,
            updatedAt: solutionsTable.updatedAt,
          })
          .from(solutionsTable)
          .where(and(eq(solutionsTable.slug, slug), isNull(solutionsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        return {
          ...fallback,
          title: row.seoTitle || row.title,
          description: row.seoDescription || defaults.description,
          image: dynamicOgImageUrl("solution", row.id, row.updatedAt, origin),
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
            ogImageVariant(absUrl(editorImage, origin), origin) ??
            dynamicOgImageUrl("case-study", row.id, row.updatedAt, origin),
          ogType: "article",
        };
      }

      case "applications": {
        const [row] = await db
          .select({
            id: applicationsTable.id,
            name: applicationsTable.name,
            title: applicationsTable.title,
            seoTitle: applicationsTable.seoTitle,
            seoDescription: applicationsTable.seoDescription,
            shortSummary: applicationsTable.shortSummary,
            screenshot: applicationsTable.screenshot,
            ogImage: applicationsTable.ogImage,
            updatedAt: applicationsTable.updatedAt,
          })
          .from(applicationsTable)
          .where(and(eq(applicationsTable.slug, slug), isNull(applicationsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const editorImage =
          (row.ogImage && row.ogImage.trim()) ||
          (row.screenshot && row.screenshot.trim()) ||
          null;
        return {
          ...fallback,
          title: row.seoTitle || row.name || row.title || SITE_NAME,
          description:
            row.seoDescription || row.shortSummary || defaults.description,
          image:
            ogImageVariant(absUrl(editorImage, origin), origin) ??
            dynamicOgImageUrl("application", row.id, row.updatedAt, origin),
        };
      }

      case "models": {
        const [row] = await db
          .select({
            id: modelsTable.id,
            title: modelsTable.title,
            seoTitle: modelsTable.seoTitle,
            seoDescription: modelsTable.seoDescription,
            shortDescription: modelsTable.shortDescription,
            heroImage: modelsTable.heroImage,
            ogImage: modelsTable.ogImage,
            updatedAt: modelsTable.updatedAt,
          })
          .from(modelsTable)
          .where(and(eq(modelsTable.slug, slug), isNull(modelsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const editorImage =
          (row.ogImage && row.ogImage.trim()) ||
          (row.heroImage && row.heroImage.trim()) ||
          null;
        return {
          ...fallback,
          title: row.seoTitle || row.title || SITE_NAME,
          description:
            row.seoDescription || row.shortDescription || defaults.description,
          image:
            ogImageVariant(absUrl(editorImage, origin), origin) ??
            dynamicOgImageUrl("model", row.id, row.updatedAt, origin),
        };
      }

      case "workshops": {
        const [row] = await db
          .select({
            id: workshopsTable.id,
            title: workshopsTable.title,
            shortDescription: workshopsTable.shortDescription,
            heroImage: workshopsTable.heroImage,
            seo: workshopsTable.seo,
            updatedAt: workshopsTable.updatedAt,
          })
          .from(workshopsTable)
          .where(and(eq(workshopsTable.slug, slug), isNull(workshopsTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const seoTitle = (row.seo?.title ?? "").trim();
        const seoDescription = (row.seo?.description ?? "").trim();
        const editorImage = (row.heroImage && row.heroImage.trim()) || null;
        return {
          ...fallback,
          title: seoTitle || row.title || SITE_NAME,
          description:
            seoDescription || row.shortDescription || defaults.description,
          image:
            ogImageVariant(absUrl(editorImage, origin), origin) ??
            dynamicOgImageUrl("workshop", row.id, row.updatedAt, origin),
        };
      }

      case "library":
      case "webinars": {
        const [row] = await db
          .select({
            title: collateralTable.title,
            subtitle: collateralTable.subtitle,
            description: collateralTable.description,
            heroImage: collateralTable.heroImage,
          })
          .from(collateralTable)
          .where(and(eq(collateralTable.slug, slug), isNull(collateralTable.deletedAt)))
          .limit(1);
        if (!row) break;
        const description =
          (row.subtitle && row.subtitle.trim()) ||
          (row.description && row.description.trim()) ||
          defaults.description;
        return {
          ...fallback,
          title: row.title || SITE_NAME,
          description,
          image: ogImageVariant(absUrl(row.heroImage, origin), origin) ?? defaults.image,
          ogType: "article",
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
            ogImageVariant(absUrl(editorImage, origin), origin) ??
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
            ogImageVariant(absUrl(editorImage, origin), origin) ??
            dynamicOgImageUrl("polaris", row.id, row.updatedAt, origin),
          ogType: "article",
        };
      }

      case "team": {
        const [row] = await db
          .select({
            name: teamMembersTable.name,
            jobTitle: teamMembersTable.jobTitle,
            shortDescription: teamMembersTable.shortDescription,
            imageUrl: teamMembersTable.imageUrl,
          })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.slug, slug))
          .limit(1);
        if (!row) break;
        const description =
          (row.shortDescription && row.shortDescription.trim()) ||
          (row.jobTitle
            ? `${row.name} — ${row.jobTitle} at The Synozur Alliance.`
            : defaults.description);
        return {
          ...fallback,
          title: `${row.name} | The Synozur Alliance`,
          description,
          image: ogImageVariant(absUrl(row.imageUrl, origin), origin) ?? defaults.image,
          ogType: "article",
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
