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

/**
 * Build the raw JSON-LD data object for an Event.
 * Exported as a pure function so it can be unit-tested without a DOM.
 */
export function buildEventJsonLdData(
  props: EventJsonLdProps,
): Record<string, unknown> {
  const canonical = `${SITE_ORIGIN}/events/${props.slug}`;
  const start = toIso(props.startDate);
  const end = toIso(props.endDate);
  const img = absolutize(props.image ?? null);

  const hasPhysical =
    !!props.location && props.location.trim().length > 0;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: props.name,
    url: canonical,
    eventAttendanceMode: hasPhysical
      ? "https://schema.org/OfflineEventAttendanceMode"
      : "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
  };

  if (props.description) data.description = props.description;
  if (start) data.startDate = start;
  if (end) data.endDate = end;
  if (img) data.image = img;

  if (hasPhysical) {
    data.location = {
      "@type": "Place",
      name: props.location,
      address: props.location,
    };
  } else {
    data.location = {
      "@type": "VirtualLocation",
      url: props.registrationUrl ?? canonical,
    };
  }

  data.organizer = {
    "@type": "Organization",
    name: props.organizerName ?? SITE_NAME,
    url: props.organizerUrl ?? SITE_ORIGIN,
  };

  if (props.registrationUrl) {
    data.offers = {
      "@type": "Offers",
      url: props.registrationUrl,
      availability: "https://schema.org/InStock",
    };
  }

  return data;
}

export function EventJsonLd(props: EventJsonLdProps) {
  useEffect(() => {
    const data = buildEventJsonLdData(props);

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
    props.slug,
    props.name,
    props.description,
    props.image,
    props.startDate,
    props.endDate,
    props.location,
    props.registrationUrl,
    props.organizerName,
    props.organizerUrl,
  ]);

  return null;
}
