import { useEffect } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "event-jsonld";

function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  }
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

export interface EventJsonLdProps {
  slug: string;
  name: string;
  description?: string | null;
  image?: string | null;
  startDate: string | Date;
  endDate?: string | Date | null;
  location?: string | null;
  registrationUrl?: string | null;
  organizerName?: string | null;
  organizerUrl?: string | null;
}

export function EventJsonLd({
  slug,
  name,
  description,
  image,
  startDate,
  endDate,
  location,
  registrationUrl,
  organizerName,
  organizerUrl,
}: EventJsonLdProps) {
  useEffect(() => {
    const canonical = `${SITE_ORIGIN}/events/${slug}`;
    const start = toIso(startDate);
    const end = toIso(endDate);
    const img = absolutize(image ?? null);

    const hasPhysical = !!location && location.trim().length > 0;

    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Event",
      name,
      url: canonical,
      eventAttendanceMode: hasPhysical
        ? "https://schema.org/OfflineEventAttendanceMode"
        : "https://schema.org/OnlineEventAttendanceMode",
      eventStatus: "https://schema.org/EventScheduled",
    };
    if (description) data.description = description;
    if (start) data.startDate = start;
    if (end) data.endDate = end;
    if (img) data.image = img;

    if (hasPhysical) {
      data.location = {
        "@type": "Place",
        name: location,
        address: location,
      };
    } else {
      data.location = {
        "@type": "VirtualLocation",
        url: registrationUrl ?? canonical,
      };
    }

    data.organizer = {
      "@type": "Organization",
      name: organizerName ?? SITE_NAME,
      url: organizerUrl ?? SITE_ORIGIN,
    };

    if (registrationUrl) {
      data.offers = {
        "@type": "Offers",
        url: registrationUrl,
        availability: "https://schema.org/InStock",
      };
    }

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
    slug,
    name,
    description,
    image,
    startDate,
    endDate,
    location,
    registrationUrl,
    organizerName,
    organizerUrl,
  ]);

  return null;
}
