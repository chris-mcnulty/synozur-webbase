import { useEffect } from "react";

export function OrganizationJsonLd() {
  useEffect(() => {
    const id = "org-jsonld";
    if (document.getElementById(id)) return;
    const data = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "The Synozur Alliance",
      legalName: "The Synozur Alliance, LLC",
      url: "https://www.synozur.com",
      logo: "https://www.synozur.com/favicon.svg",
      address: {
        "@type": "PostalAddress",
        streetAddress: "13300 Bothell Everett Hwy, Suite 303",
        addressLocality: "Mill Creek",
        addressRegion: "WA",
        postalCode: "98012",
        addressCountry: "US",
      },
      sameAs: [
        "https://www.linkedin.com/company/synozur",
      ],
    };
    const s = document.createElement("script");
    s.id = id;
    s.type = "application/ld+json";
    s.text = JSON.stringify(data);
    document.head.appendChild(s);
  }, []);
  return null;
}
