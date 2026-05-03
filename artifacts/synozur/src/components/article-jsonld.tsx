import { useEffect } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "article-jsonld";

function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  }
}

export interface ArticleJsonLdProps {
  slug: string;
  title: string;
  description?: string | null;
  image?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  authorName?: string | null;
  authorUrl?: string | null;
  /**
   * When true, emit `@type: NewsArticle` instead of `Article`. Insights
   * tagged `news` (or filed under a News category) opt into the NewsArticle
   * schema so Google can route them to the news carousel and Top Stories
   * surfaces.
   */
  isNews?: boolean;
}

export function ArticleJsonLd({
  slug,
  title,
  description,
  image,
  publishedAt,
  updatedAt,
  authorName,
  authorUrl,
  isNews,
}: ArticleJsonLdProps) {
  useEffect(() => {
    const canonical = `${SITE_ORIGIN}/insights/${slug}`;
    const img = absolutize(image ?? null);
    const author = authorName
      ? {
          "@type": "Person",
          name: authorName,
          ...(authorUrl ? { url: authorUrl } : {}),
        }
      : undefined;

    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": isNews ? "NewsArticle" : "Article",
      headline: title,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": canonical,
      },
      url: canonical,
    };
    if (description) data.description = description;
    if (img) data.image = img;
    if (publishedAt) data.datePublished = publishedAt;
    if (updatedAt ?? publishedAt) data.dateModified = updatedAt ?? publishedAt;
    if (author) data.author = author;
    data.publisher = {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_ORIGIN}/favicon.svg`,
      },
    };

    const existing = document.getElementById(ID);
    if (existing) existing.remove();
    const s = document.createElement("script");
    s.id = ID;
    s.type = "application/ld+json";
    s.text = JSON.stringify(data);
    document.head.appendChild(s);

    return () => {
      const el = document.getElementById(ID);
      if (el) el.remove();
    };
  }, [slug, title, description, image, publishedAt, updatedAt, authorName, authorUrl, isNews]);

  return null;
}
