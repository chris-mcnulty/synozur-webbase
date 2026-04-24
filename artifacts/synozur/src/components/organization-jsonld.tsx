import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const SITE_URL = "https://www.synozur.com";

const ORG_DEFAULTS = {
  name: "The Synozur Alliance",
  legalName: "The Synozur Alliance, LLC",
  logo: `${SITE_URL}/favicon.svg`,
  streetAddress: "13300 Bothell Everett Hwy, Suite 303",
  addressLocality: "Mill Creek",
  addressRegion: "WA",
  postalCode: "98012",
  addressCountry: "US",
  sameAs: ["https://www.linkedin.com/company/synozur"],
} as const;

export function OrganizationJsonLd() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const id = "org-jsonld";

    // Resolve logo URL — prefer DB org logo, fall back to default.
    let logoUrl = ORG_DEFAULTS.logo;
    if (settings?.orgLogoUrl) {
      const raw = settings.orgLogoUrl;
      try {
        // If it's already an absolute URL, use it as-is.
        new URL(raw);
        logoUrl = raw;
      } catch {
        // Relative path — prepend the site origin.
        logoUrl = `${SITE_URL}/${raw.replace(/^\/+/, "")}`;
      }
    }

    const data = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: settings?.orgName ?? ORG_DEFAULTS.name,
      legalName: settings?.orgLegalName ?? ORG_DEFAULTS.legalName,
      url: SITE_URL,
      logo: logoUrl,
      address: {
        "@type": "PostalAddress",
        streetAddress: settings?.orgStreetAddress ?? ORG_DEFAULTS.streetAddress,
        addressLocality: settings?.orgAddressLocality ?? ORG_DEFAULTS.addressLocality,
        addressRegion: settings?.orgAddressRegion ?? ORG_DEFAULTS.addressRegion,
        postalCode: settings?.orgPostalCode ?? ORG_DEFAULTS.postalCode,
        addressCountry: settings?.orgAddressCountry ?? ORG_DEFAULTS.addressCountry,
      },
      sameAs:
        settings?.orgSameAs && settings.orgSameAs.length > 0
          ? settings.orgSameAs
          : ORG_DEFAULTS.sameAs,
    };

    // Replace the existing element so updates are reflected without reload.
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const s = document.createElement("script");
    s.id = id;
    s.type = "application/ld+json";
    s.text = JSON.stringify(data);
    document.head.appendChild(s);
  }, [settings]);

  return null;
}
