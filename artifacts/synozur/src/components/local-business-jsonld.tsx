import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "local-business-jsonld";

// Static defaults for fields the public `site_settings` projection does not
// yet expose. These match the office contact info that already appears on the
// /contact page and the OrganizationJsonLd defaults; geo coordinates are the
// approximate centroid of the Mill Creek, WA office.
const DEFAULTS = {
  streetAddress: "13300 Bothell Everett Hwy, Suite 303",
  addressLocality: "Mill Creek",
  addressRegion: "WA",
  postalCode: "98012",
  addressCountry: "US",
  email: "hello@synozur.com",
  telephone: "+1-425-555-0100",
  geo: { latitude: 47.8606, longitude: -122.2042 },
  openingHours: [
    {
      days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "09:00",
      closes: "17:00",
    },
  ],
  sameAs: ["https://www.linkedin.com/company/synozur"],
} as const;

function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${SITE_ORIGIN}${path}`;
  }
}

export function LocalBusinessJsonLd() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const logo = absolutize(settings?.orgLogoUrl) ?? `${SITE_ORIGIN}/favicon.svg`;
    const sameAs =
      settings?.orgSameAs && settings.orgSameAs.length > 0
        ? settings.orgSameAs
        : [...DEFAULTS.sameAs];

    const latitude =
      typeof settings?.orgGeoLatitude === "number"
        ? settings.orgGeoLatitude
        : DEFAULTS.geo.latitude;
    const longitude =
      typeof settings?.orgGeoLongitude === "number"
        ? settings.orgGeoLongitude
        : DEFAULTS.geo.longitude;
    const openingHours =
      settings?.orgOpeningHours && settings.orgOpeningHours.length > 0
        ? settings.orgOpeningHours
        : DEFAULTS.openingHours;

    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": `${SITE_ORIGIN}/contact#localbusiness`,
      name: settings?.orgName ?? SITE_NAME,
      url: `${SITE_ORIGIN}/contact`,
      logo,
      image: logo,
      email: DEFAULTS.email,
      telephone: settings?.orgTelephone ?? DEFAULTS.telephone,
      address: {
        "@type": "PostalAddress",
        streetAddress: settings?.orgStreetAddress ?? DEFAULTS.streetAddress,
        addressLocality: settings?.orgAddressLocality ?? DEFAULTS.addressLocality,
        addressRegion: settings?.orgAddressRegion ?? DEFAULTS.addressRegion,
        postalCode: settings?.orgPostalCode ?? DEFAULTS.postalCode,
        addressCountry: settings?.orgAddressCountry ?? DEFAULTS.addressCountry,
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude,
        longitude,
      },
      openingHoursSpecification: openingHours.map((spec) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: spec.days,
        opens: spec.opens,
        closes: spec.closes,
      })),
      sameAs,
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
  }, [settings]);

  return null;
}
