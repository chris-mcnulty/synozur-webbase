import { useEffect } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "review-jsonld";

export interface ReviewItem {
  quote: string;
  authorName: string;
  authorRole?: string | null;
  organization: string;
}

export interface ReviewJsonLdProps {
  /** Page-level canonical URL the reviews live on (for `itemReviewed.url`). */
  canonicalUrl: string;
  reviews: ReviewItem[];
  /**
   * Stars to advertise via AggregateRating. Defaults to 5 — the public
   * testimonials block today only surfaces hand-picked endorsements, so a
   * 5/5 aggregate accurately reflects the curated set.
   */
  ratingValue?: number;
  bestRating?: number;
  worstRating?: number;
}

export function ReviewJsonLd({
  canonicalUrl,
  reviews,
  ratingValue = 5,
  bestRating = 5,
  worstRating = 1,
}: ReviewJsonLdProps) {
  useEffect(() => {
    if (!reviews.length) return;

    const itemReviewed = {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    };

    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: canonicalUrl,
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue,
        bestRating,
        worstRating,
        reviewCount: reviews.length,
      },
      review: reviews.map((r) => ({
        "@type": "Review",
        reviewBody: r.quote,
        author: {
          "@type": "Person",
          name: r.authorName,
          ...(r.authorRole ? { jobTitle: r.authorRole } : {}),
          ...(r.organization
            ? {
                worksFor: {
                  "@type": "Organization",
                  name: r.organization,
                },
              }
            : {}),
        },
        itemReviewed,
        reviewRating: {
          "@type": "Rating",
          ratingValue: bestRating,
          bestRating,
          worstRating,
        },
      })),
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
  }, [canonicalUrl, reviews, ratingValue, bestRating, worstRating]);

  return null;
}
