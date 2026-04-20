import { useEffect } from "react";
import {
  DEFAULT_OG_IMAGE,
  PAGE_TYPES,
  SITE_NAME,
  SITE_ORIGIN,
  buildTitle,
  derivePageType,
  type PageType,
} from "./seo-config";

interface MetaProps {
  title: string;
  description?: string;
  /** Path used to compute canonical + og:url. Defaults to the current pathname. */
  path?: string;
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

/** A pathname is "detail" when it has a second segment under a known section. */
function inferIsDetail(pathname: string): boolean {
  const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
  return segments.length >= 2 && segments[1].length > 0;
}

export function Meta({
  title,
  description,
  path,
  image,
  type,
  rawTitle = false,
  feedHref,
  pageType,
  isDetail,
  noindex,
}: MetaProps) {
  useEffect(() => {
    const pathname =
      path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const resolvedType: PageType = pageType ?? derivePageType(pathname);
    const config = PAGE_TYPES[resolvedType];

    const detail = isDetail ?? inferIsDetail(pathname);
    const fullTitle = buildTitle(title, resolvedType, {
      isDetail: detail,
      rawTitle,
    });

    const resolvedDescription = description ?? config.defaultDescription;
    const resolvedOgType = type ?? config.ogType;
    const resolvedImage = image ?? config.defaultImage ?? DEFAULT_OG_IMAGE;
    const resolvedNoindex = noindex ?? config.noindex ?? false;

    document.title = fullTitle;

    const url = `${SITE_ORIGIN}${pathname}`;
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
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", absImage);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:image", absImage);
    upsertLink("canonical", url);

    if (resolvedNoindex) {
      upsertMeta("name", "robots", "noindex,nofollow");
    } else {
      removeMeta("name", "robots");
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
    image,
    type,
    rawTitle,
    feedHref,
    pageType,
    isDetail,
    noindex,
  ]);

  return null;
}
