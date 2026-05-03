import { useEffect } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "video-jsonld";

function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url.replace(/^\/+/, "")}`;
  }
}

/**
 * Format a duration in whole seconds as an ISO 8601 duration (e.g.
 * `PT1H23M45S`). Returns undefined for null / non-positive inputs so callers
 * can omit the field entirely from the JSON-LD payload.
 */
export function secondsToIsoDuration(
  seconds: number | null | undefined,
): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let out = "PT";
  if (h > 0) out += `${h}H`;
  if (m > 0) out += `${m}M`;
  if (s > 0 || (h === 0 && m === 0)) out += `${s}S`;
  return out;
}

export interface VideoJsonLdProps {
  canonicalUrl: string;
  name: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  uploadDate?: string | null;
  durationSeconds?: number | null;
  contentUrl?: string | null;
  embedUrl?: string | null;
}

export function VideoJsonLd({
  canonicalUrl,
  name,
  description,
  thumbnailUrl,
  uploadDate,
  durationSeconds,
  contentUrl,
  embedUrl,
}: VideoJsonLdProps) {
  useEffect(() => {
    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name,
      url: canonicalUrl,
    };
    const desc = description?.trim();
    if (desc) data.description = desc;
    const thumb = absolutize(thumbnailUrl);
    if (thumb) data.thumbnailUrl = thumb;
    if (uploadDate) data.uploadDate = uploadDate;
    const duration = secondsToIsoDuration(durationSeconds);
    if (duration) data.duration = duration;
    const content = absolutize(contentUrl);
    if (content) data.contentUrl = content;
    const embed = absolutize(embedUrl);
    if (embed) data.embedUrl = embed;
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
  }, [
    canonicalUrl,
    name,
    description,
    thumbnailUrl,
    uploadDate,
    durationSeconds,
    contentUrl,
    embedUrl,
  ]);

  return null;
}
