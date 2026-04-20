import { useEffect } from "react";

interface MetaProps {
  title: string;
  description?: string;
  /** Path used to compute canonical + og:url. Defaults to the current pathname. */
  path?: string;
  /** Absolute or root-relative path to the OG image. */
  image?: string;
  /** "website" (default) or "article". */
  type?: "website" | "article";
  /** If true, do not append the site name to the title. */
  rawTitle?: boolean;
  /** Optional RSS/Atom feed URL — adds <link rel="alternate" type="application/rss+xml">. */
  feedHref?: string;
}

const SITE_NAME = "The Synozur Alliance";
const SITE_ORIGIN = "https://www.synozur.com";
const DEFAULT_OG_IMAGE = "/images/hero-bg.png";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
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

export function Meta({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  type = "website",
  rawTitle = false,
  feedHref,
}: MetaProps) {
  useEffect(() => {
    const fullTitle = rawTitle ? title : `${title} | ${SITE_NAME}`;
    document.title = fullTitle;

    const pathname = path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const url = `${SITE_ORIGIN}${pathname}`;
    const absImage = image.startsWith("http") ? image : `${SITE_ORIGIN}${image}`;

    if (description) {
      upsertMeta("name", "description", description);
      upsertMeta("property", "og:description", description);
      upsertMeta("name", "twitter:description", description);
    }

    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", absImage);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:image", absImage);
    upsertLink("canonical", url);

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
  }, [title, description, path, image, type, rawTitle, feedHref]);

  return null;
}
