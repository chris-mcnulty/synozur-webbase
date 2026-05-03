import { useEffect } from "react";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

const ID = "person-jsonld";

function absolutize(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).toString();
  } catch {
    return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url.replace(/^\/+/, "")}`;
  }
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

export interface PersonJsonLdProps {
  slug: string;
  name: string;
  jobTitle: string;
  description?: string | null;
  image?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  website?: string | null;
}

export function PersonJsonLd({
  slug,
  name,
  jobTitle,
  description,
  image,
  email,
  linkedinUrl,
  website,
}: PersonJsonLdProps) {
  useEffect(() => {
    const canonical = `${SITE_ORIGIN}/team/${slug}`;
    const sameAs = [linkedinUrl, website]
      .filter(isHttpUrl)
      .map((u) => u!.trim());

    const data: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Person",
      name,
      jobTitle,
      url: canonical,
      worksFor: {
        "@type": "Organization",
        name: SITE_NAME,
        url: SITE_ORIGIN,
      },
    };
    const img = absolutize(image);
    if (img) data.image = img;
    if (description) data.description = description;
    if (email) data.email = email;
    if (sameAs.length > 0) data.sameAs = sameAs;

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
  }, [slug, name, jobTitle, description, image, email, linkedinUrl, website]);

  return null;
}
