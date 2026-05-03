import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_OG_IMAGE,
  DETAIL_PREFIXES,
  PAGE_TYPES,
  SITE_NAME,
  SITE_ORIGIN,
  derivePageType,
  type PageType,
} from "./seo-config";
import { api } from "./api";

interface MetaProps {
  title: string;
  description?: string;
  /** Path used to compute canonical + og:url. Defaults to the current pathname. */
  path?: string;
  /**
   * Override the canonical path independently of the current pathname. When
   * provided, both `<link rel="canonical">` and `<meta property="og:url">`
   * resolve to `${SITE_ORIGIN}${canonicalPath}` instead of the current path.
   * Use this on pages that render the same content as another URL (e.g.
   * pillar overviews that mirror service detail pages).
   */
  canonicalPath?: string;
  /** Absolute or root-relative path to the OG image. */
  image?: string;
  /** "website" (default) or "article". Overrides the page-type default. */
  type?: "website" | "article";
  /** If true, do not append the site name to the title. */
  rawTitle?: boolean;
  /** Optional RSS/Atom feed URL — adds <link rel="alternate" type="application/rss+xml">. */
  feedHref?: string;
  /**
   * Override the page-type classification. When omitted, the type is inferred
   * from the current pathname via `derivePageType`.
   */
  pageType?: PageType;
  /**
   * When true, render the title as "{title} | {Section} | {Site}" using the
   * resolved page type's section label. When omitted, detail status is inferred
   * from the URL (a route with a slug after a known section prefix).
   */
  isDetail?: boolean;
  /** Override robots policy. When omitted, the page-type default is used. */
  noindex?: boolean;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: "name" | "property", key: string) {
  const el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * A pathname is "detail" when it has a non-empty slug under a section prefix
 * that is known to have detail routes. This excludes hub pages (e.g.
 * `/services-overview/default`) and single-segment pages.
 */
function inferIsDetail(pathname: string): boolean {
  const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length < 2 || !segments[1] || segments[1] === "default") {
    return false;
  }
  return DETAIL_PREFIXES.has(segments[0]);
}

export function Meta({
  title,
  description,
  path,
  canonicalPath,
  image,
  type,
  rawTitle = false,
  feedHref,
  pageType,
  isDetail,
  noindex,
}: MetaProps) {
  const { data: siteSettings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    // The raw browser pathname includes the Vite/Wouter base path prefix.
    // Strip it before classification so derivePageType / inferIsDetail receive
    // the Wouter-relative path (e.g. "/services/my-slug" not "/subdir/services/my-slug").
    // The full raw pathname is kept for canonical / og:url.
    const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
    const rawPathname =
      path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const normalizedPathname =
      base && rawPathname.startsWith(base)
        ? rawPathname.slice(base.length) || "/"
        : rawPathname;

    const resolvedType: PageType = pageType ?? derivePageType(normalizedPathname);
    const config = PAGE_TYPES[resolvedType];

    const detail = isDetail ?? inferIsDetail(normalizedPathname);

    // Build title — apply DB title template when one is set and rawTitle is not requested.
    let fullTitle: string;
    if (rawTitle) {
      fullTitle = title;
    } else {
      const dbTemplate = siteSettings?.seoDefaultTitleTemplate;
      if (dbTemplate) {
        // Template replaces {page} with the leaf title; the rest is literal.
        // e.g. "{page} | The Synozur Alliance" → "My Page | The Synozur Alliance"
        fullTitle = dbTemplate.replace("{page}", title);
      } else {
        // Fall back to the static section-aware title format.
        if (config.useSectionInTitle && detail && config.section) {
          fullTitle = `${title} | ${config.section} | ${SITE_NAME}`;
        } else {
          fullTitle = `${title} | ${SITE_NAME}`;
        }
      }
    }

    const resolvedDescription = description ?? siteSettings?.seoDefaultDescription ?? config.defaultDescription;
    const resolvedOgType = type ?? config.ogType;
    // Prefer page-level image over DB OG image, then page type default, then global default.
    const dbOgImage = siteSettings?.seoDefaultOgImageUrl ?? null;
    const resolvedImage = image ?? dbOgImage ?? config.defaultImage ?? DEFAULT_OG_IMAGE;
    const resolvedNoindex = noindex ?? config.noindex ?? false;

    // Twitter card type from DB, falling back to summary_large_image.
    const twitterCardType = siteSettings?.seoTwitterCardType ?? "summary_large_image";

    document.title = fullTitle;

    const url = `${SITE_ORIGIN}${rawPathname}`;
    const canonicalUrl = canonicalPath
      ? `${SITE_ORIGIN}${canonicalPath}`
      : url;
    const absImage = resolvedImage.startsWith("http")
      ? resolvedImage
      : `${SITE_ORIGIN}${resolvedImage}`;

    if (resolvedDescription) {
      upsertMeta("name", "description", resolvedDescription);
      upsertMeta("property", "og:description", resolvedDescription);
      upsertMeta("name", "twitter:description", resolvedDescription);
    }

    upsertMeta("property", "og:type", resolvedOgType);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:image", absImage);
    upsertMeta("name", "twitter:card", twitterCardType);
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:image", absImage);
    upsertLink("canonical", canonicalUrl);

    // twitter:site / twitter:creator from DB handle.
    const twitterHandle = siteSettings?.seoTwitterHandle;
    if (twitterHandle) {
      upsertMeta("name", "twitter:site", twitterHandle);
      upsertMeta("name", "twitter:creator", twitterHandle);
    }

    if (resolvedNoindex) {
      upsertMeta("name", "robots", "noindex,nofollow");
    } else {
      // L18 / #163: emit explicit preview directives so Google doesn't clip
      // rich SERP previews on indexable pages. `max-snippet:-1` allows the
      // full description, `max-image-preview:large` opts into the large image
      // card, `max-video-preview:-1` allows full video preview duration.
      upsertMeta(
        "name",
        "robots",
        "max-snippet:-1, max-image-preview:large, max-video-preview:-1",
      );
    }

    // RSS autodiscovery (per-page). Always remove first so navigation away
    // from the feed page strips it cleanly.
    const existing = document.head.querySelector(
      'link[rel="alternate"][type="application/rss+xml"][data-feed="page"]',
    );
    if (existing) existing.remove();
    if (feedHref) {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("type", "application/rss+xml");
      link.setAttribute("title", `${SITE_NAME} — The Feed`);
      link.setAttribute("href", feedHref);
      link.setAttribute("data-feed", "page");
      document.head.appendChild(link);
    }
  }, [
    title,
    description,
    path,
    canonicalPath,
    image,
    type,
    rawTitle,
    feedHref,
    pageType,
    isDetail,
    noindex,
    siteSettings,
  ]);

  return null;
}
