/**
 * SEO model — page-type registry.
 *
 * Each page in the marketing site is classified into one PageType. The type
 * supplies sensible defaults (section label for the title, fallback OG image,
 * fallback description, og:type, robots policy) so individual pages only need
 * to provide the leaf title and (optionally) a tailored description.
 *
 * Title format:
 *   - Detail/leaf pages in a section: "{Page Name} | {Section} | The Synozur Alliance"
 *   - Section hubs and one-off pages:  "{Page Name} | The Synozur Alliance"
 *   - Home (and any pageType.useSectionInTitle === false): "{Page Name} | The Synozur Alliance"
 */

export const SITE_NAME = "The Synozur Alliance";
export const SITE_ORIGIN = "https://www.synozur.com";
export const DEFAULT_OG_IMAGE = "/images/hero-bg.png";

export type PageType =
  | "home"
  | "solution"
  | "service"
  | "workshop"
  | "case-study"
  | "application"
  | "model"
  | "insight"
  | "webinar"
  | "library"
  | "item"
  | "event"
  | "faq"
  | "company"
  | "legal"
  | "utility"
  | "not-found";

export interface PageTypeConfig {
  /** Section label that appears in the title for detail pages within the type. */
  section: string;
  /** Fallback meta description when a page does not supply its own. */
  defaultDescription: string;
  /** Fallback OG image (root-relative or absolute URL). */
  defaultImage?: string;
  /** OpenGraph type — `article` for editorial detail pages, `website` otherwise. */
  ogType: "website" | "article";
  /** When true, detail pages of this type render as "{title} | {section} | {site}". */
  useSectionInTitle: boolean;
  /** When true, emit `<meta name="robots" content="noindex,nofollow">`. */
  noindex?: boolean;
}

export const PAGE_TYPES: Record<PageType, PageTypeConfig> = {
  home: {
    section: "",
    defaultDescription:
      "Strategy, AI, and Microsoft 365 advisory from The Synozur Alliance — practical guidance for leaders shaping the modern workplace.",
    ogType: "website",
    useSectionInTitle: false,
  },
  solution: {
    section: "Solutions",
    defaultDescription:
      "End-to-end solutions from The Synozur Alliance — combining strategy, technology, and change to deliver measurable outcomes.",
    ogType: "website",
    useSectionInTitle: true,
  },
  service: {
    section: "Services",
    defaultDescription:
      "Advisory and delivery services from The Synozur Alliance covering strategy, AI, Microsoft 365, and the modern employee experience.",
    ogType: "website",
    useSectionInTitle: true,
  },
  workshop: {
    section: "Workshops",
    defaultDescription:
      "Hands-on workshops from The Synozur Alliance that move teams from ambiguity to action on AI, Microsoft 365, and digital strategy.",
    ogType: "website",
    useSectionInTitle: true,
  },
  "case-study": {
    section: "Case Studies",
    defaultDescription:
      "Client outcomes from The Synozur Alliance — real engagements showing how strategy, AI, and Microsoft 365 deliver business value.",
    ogType: "article",
    useSectionInTitle: true,
  },
  application: {
    section: "Applications",
    defaultDescription:
      "Applications and accelerators built by The Synozur Alliance to extend Microsoft 365, Copilot, and the modern workplace.",
    ogType: "website",
    useSectionInTitle: true,
  },
  model: {
    section: "Models",
    defaultDescription:
      "AI, KMMM, GTM, Content, and Company OS maturity models from The Synozur Alliance.",
    ogType: "website",
    useSectionInTitle: true,
  },
  insight: {
    section: "Insights",
    defaultDescription:
      "The Feed from The Synozur Alliance — perspectives on AI, Microsoft 365, leadership, and the modern workplace.",
    ogType: "article",
    useSectionInTitle: true,
  },
  webinar: {
    section: "Webinars",
    defaultDescription:
      "Live and on-demand webinars from The Synozur Alliance on AI, Microsoft 365, and the future of work.",
    ogType: "website",
    useSectionInTitle: true,
  },
  library: {
    section: "Library",
    defaultDescription:
      "Guides, frameworks, and reference material from The Synozur Alliance library.",
    ogType: "website",
    useSectionInTitle: true,
  },
  item: {
    section: "Catalog",
    defaultDescription:
      "Catalog items and offerings from The Synozur Alliance.",
    ogType: "website",
    useSectionInTitle: true,
  },
  event: {
    section: "Events",
    defaultDescription:
      "Upcoming events from The Synozur Alliance — conferences, briefings, and community gatherings.",
    ogType: "website",
    useSectionInTitle: true,
  },
  faq: {
    section: "",
    defaultDescription:
      "Answers to the questions we hear most often about working with The Synozur Alliance.",
    ogType: "website",
    useSectionInTitle: false,
  },
  company: {
    section: "",
    defaultDescription:
      "About The Synozur Alliance — the people, partners, and clients shaping our work.",
    ogType: "website",
    useSectionInTitle: false,
  },
  legal: {
    section: "",
    defaultDescription:
      "Legal information for The Synozur Alliance.",
    ogType: "website",
    useSectionInTitle: false,
  },
  utility: {
    section: "",
    defaultDescription:
      "The Synozur Alliance.",
    ogType: "website",
    useSectionInTitle: false,
  },
  "not-found": {
    section: "",
    defaultDescription: "The page you were looking for is not on the map.",
    ogType: "website",
    useSectionInTitle: false,
    noindex: true,
  },
};

/**
 * Map a pathname to a PageType. Order matters: more specific prefixes first.
 * Unknown paths fall back to `utility`.
 */
export function derivePageType(pathname: string): PageType {
  const p = pathname.replace(/\/+$/, "") || "/";

  if (p === "/") return "home";

  // Detail and hub routes — keyed by the first path segment.
  const segment = p.split("/")[1] ?? "";
  switch (segment) {
    case "solutions":
      return "solution";
    case "services":
    case "services-overview":
      return "service";
    case "workshops":
      return "workshop";
    case "case-studies":
      return "case-study";
    case "applications":
      return "application";
    case "models":
      return "model";
    case "insights":
      return "insight";
    case "webinars":
      return "webinar";
    case "library":
      return "library";
    case "items":
      return "item";
    case "events":
      return "event";
    case "faq":
      return "faq";
    case "about":
    case "team":
    case "partners":
    case "clients":
      return "company";
    case "privacy":
    case "terms":
      return "legal";
    case "contact":
    case "start":
    case "polaris":
    case "sign-in":
    case "sign-up":
      return "utility";
    default:
      return "utility";
  }
}

/**
 * First path segments that have dedicated detail routes (/:segment/:slug).
 * Two-segment paths whose first segment is NOT in this set (e.g.
 * `/services-overview/default`) are hub pages, not detail pages.
 */
export const DETAIL_PREFIXES = new Set<string>([
  "services",
  "solutions",
  "case-studies",
  "applications",
  "models",
  "workshops",
  "library",
  "webinars",
  "items",
  "insights",
]);

/** Build the document title from a page-type config and a leaf title. */
export function buildTitle(
  leafTitle: string,
  type: PageType,
  options: { isDetail?: boolean; rawTitle?: boolean } = {},
): string {
  if (options.rawTitle) return leafTitle;
  const config = PAGE_TYPES[type];
  if (config.useSectionInTitle && options.isDetail && config.section) {
    return `${leafTitle} | ${config.section} | ${SITE_NAME}`;
  }
  return `${leafTitle} | ${SITE_NAME}`;
}
