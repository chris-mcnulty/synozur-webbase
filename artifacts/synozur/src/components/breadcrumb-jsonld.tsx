import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  DETAIL_PREFIXES,
  PAGE_TYPES,
  SITE_NAME,
  SITE_ORIGIN,
  derivePageType,
} from "@/lib/seo-config";

const ID = "breadcrumb-jsonld";

interface DetailParts {
  section: string;
  sectionPath: string;
  leafPath: string;
}

function detailParts(pathname: string): DetailParts | null {
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  const segments = clean.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const first = segments[0];
  if (!first || !DETAIL_PREFIXES.has(first)) return null;
  if (segments[1] === "default") return null;
  const section = PAGE_TYPES[derivePageType(pathname)]?.section;
  if (!section) return null;
  return {
    section,
    sectionPath: `/${first}`,
    leafPath: pathname,
  };
}

function leafFromTitle(title: string): string {
  const parts = title.split(" | ").map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? title.trim();
}

function removeLd() {
  const el = document.getElementById(ID);
  if (el) el.remove();
}

function writeLd(parts: DetailParts, leaf: string) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_NAME,
        item: `${SITE_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: parts.section,
        item: `${SITE_ORIGIN}${parts.sectionPath}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: leaf,
        item: `${SITE_ORIGIN}${parts.leafPath}`,
      },
    ],
  };
  removeLd();
  const s = document.createElement("script");
  s.id = ID;
  s.type = "application/ld+json";
  s.text = JSON.stringify(data);
  document.head.appendChild(s);
}

export function BreadcrumbJsonLd() {
  const [location] = useLocation();

  useEffect(() => {
    const parts = detailParts(location);
    if (!parts) {
      removeLd();
      return;
    }

    const emit = () => {
      const leaf = leafFromTitle(document.title || "");
      if (!leaf) return;
      writeLd(parts, leaf);
    };

    emit();

    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const observer = new MutationObserver(() => emit());
    observer.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      removeLd();
    };
  }, [location]);

  return null;
}
