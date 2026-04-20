/**
 * Public collateral library — temporary mock data layer.
 *
 * Once the collateral library backend (Task #38 + the collateral library backend
 * task) lands, the four exported async functions below should be reimplemented
 * to call `GET /api/collateral/featured` and `GET /api/collateral` (or the
 * generated React Query hooks). Page components import only the async helpers
 * so the swap is non-invasive.
 */

export type CollateralType =
  | "webinar"
  | "white_paper"
  | "case_study"
  | "podcast"
  | "model"
  | "training"
  | "event"
  | "insight";

export type Pillar =
  | "strategic"
  | "technology"
  | "experiences"
  | "gtm";

export interface Collateral {
  id: string;
  slug: string;
  type: CollateralType;
  title: string;
  subtitle?: string;
  description: string;
  heroImage: string;
  pillar?: Pillar;
  tags: string[];
  /** Canonical URL — may be internal (`/case-studies/...`) or external (`https://...`). */
  url: string;
  external?: boolean;
  publishedAt: string;
  featured: boolean;
  featuredRank?: number;
  videoUrl?: string;
  downloadUrl?: string;
}

export const TYPE_LABELS: Record<CollateralType, string> = {
  webinar: "WEBINAR",
  white_paper: "WHITE PAPER",
  case_study: "CASE STUDY",
  podcast: "PODCAST",
  model: "MODEL",
  training: "WORKSHOP",
  event: "EVENT",
  insight: "INSIGHT",
};

export const PILLAR_LABELS: Record<Pillar, string> = {
  strategic: "Strategic Transformation",
  technology: "Technology Transformation",
  experiences: "Experiences",
  gtm: "Go-to-Market",
};

const DATA: Collateral[] = [
  {
    id: "techcon-365-seattle",
    slug: "techcon-365-seattle",
    type: "event",
    title: "TechCon 365 Seattle",
    description:
      "Join our team at TechCon 365 Seattle for sessions on Microsoft 365, Copilot, and the future of the digital workplace.",
    heroImage: "/images/home/feed/feed-1-techcon-365.jpeg",
    pillar: "technology",
    tags: ["Events", "Microsoft 365", "Conference"],
    url: "https://www.synozur.com/event-details/techcon-365-seattle",
    external: true,
    publishedAt: "2025-09-01",
    featured: true,
    featuredRank: 1,
  },
  {
    id: "polaris-strategy-unplugged-with-dr-john-hillen",
    slug: "polaris-strategy-unplugged-with-dr-john-hillen",
    type: "podcast",
    title: "Strategy Dialogues with Dr. John Hillen",
    description:
      "An in-depth Polaris conversation with Dr. John Hillen on leadership, strategy, and navigating uncertainty.",
    heroImage: "/images/home/feed/feed-2-strategy-dialogues.jpeg",
    pillar: "strategic",
    tags: ["Polaris", "Leadership", "Strategy"],
    url: "/polaris",
    publishedAt: "2025-06-12",
    featured: true,
    featuredRank: 2,
  },
  {
    id: "holiday-reflections-from-synozur-a-dynamic-2024",
    slug: "holiday-reflections-from-synozur-a-dynamic-2024",
    type: "insight",
    title: "2024 - A Dynamic Year",
    description:
      "Holiday reflections from the Synozur team on a year of transformation, growth, and what comes next.",
    heroImage: "/images/home/feed/feed-3-dynamic-2024.jpg",
    pillar: "strategic",
    tags: ["Insights", "Reflections"],
    url: "/insights",
    publishedAt: "2024-12-20",
    featured: true,
    featuredRank: 3,
  },
  {
    id: "transforming-your-digital-workplace-akumina",
    slug: "transforming-your-digital-workplace-akumina",
    type: "webinar",
    title: "Transform Your Digital Workplace",
    subtitle: "Co-presented with Akumina",
    description:
      "A practical webinar on how to modernize the digital workplace — from intranet strategy to employee experience platforms — without disrupting the business.",
    heroImage: "/images/home/feed/feed-4-digital-workplace.jpg",
    pillar: "technology",
    tags: ["Digital Workplace", "Akumina", "Employee Experience"],
    url: "/webinars/transforming-your-digital-workplace-akumina",
    publishedAt: "2024-11-05",
    featured: true,
    featuredRank: 4,
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  {
    id: "energy-company-reinvents-employee-expereince-and-effectiveness",
    slug: "energy-company-reinvents-employee-expereince-and-effectiveness",
    type: "case_study",
    title: "Energizing Employee Experience",
    description:
      "How a Fortune 500 energy company partnered with Synozur to reinvent its employee experience and drive measurable effectiveness gains.",
    heroImage: "/images/home/feed/feed-5-employee-experience.jpg",
    pillar: "experiences",
    tags: ["Employee Experience", "Energy", "Case Study"],
    url: "/case-studies/energy-company-reinvents-employee-expereince-and-effectiveness",
    publishedAt: "2024-10-15",
    featured: true,
    featuredRank: 5,
  },
  {
    id: "transforming-management-frameworks-at-microsoft",
    slug: "transforming-management-frameworks-at-microsoft",
    type: "case_study",
    title: "Transforming Marketing Management at Microsoft",
    description:
      "A look at how Synozur helped reshape management frameworks across a global marketing organization at Microsoft.",
    heroImage: "/images/home/feed/feed-6-marketing-microsoft.jpg",
    pillar: "strategic",
    tags: ["Microsoft", "Marketing", "Operating Model"],
    url: "/case-studies/transforming-management-frameworks-at-microsoft",
    publishedAt: "2024-08-22",
    featured: true,
    featuredRank: 6,
  },
  {
    id: "polaris-ai-predictions-2025",
    slug: "polaris-ai-predictions-2025",
    type: "podcast",
    title: "AI Predictions for 2025",
    description:
      "The Polaris team unpacks the AI trends most likely to reshape the enterprise in 2025 — and what leaders should do about them now.",
    heroImage: "/images/home/feed/feed-7-ai-predictions.jpg",
    pillar: "technology",
    tags: ["Polaris", "AI", "Predictions"],
    url: "/polaris",
    publishedAt: "2025-01-08",
    featured: true,
    featuredRank: 7,
  },
  {
    id: "ai-readiness-white-paper",
    slug: "ai-readiness-white-paper",
    type: "white_paper",
    title: "The AI Readiness Playbook",
    subtitle: "A practical guide for executive teams",
    description:
      "A comprehensive white paper on assessing AI readiness across data, governance, talent, and operating model — with diagnostic frameworks you can apply this quarter.",
    heroImage: "/images/home/feed/feed-7-ai-predictions.jpg",
    pillar: "technology",
    tags: ["AI", "White Paper", "Readiness"],
    url: "/items/ai-readiness-white-paper",
    publishedAt: "2025-03-04",
    featured: false,
    downloadUrl: "https://www.synozur.com/download/ai-readiness.pdf",
  },
  {
    id: "north-star-strategy-white-paper",
    slug: "north-star-strategy-white-paper",
    type: "white_paper",
    title: "Finding Your North Star",
    subtitle: "A framework for purpose-driven strategy",
    description:
      "How leadership teams can translate purpose into a living strategy that survives quarterly noise — with a step-by-step framework and worked examples.",
    heroImage: "/images/home/feed/feed-3-dynamic-2024.jpg",
    pillar: "strategic",
    tags: ["Strategy", "Purpose", "Leadership"],
    url: "/items/north-star-strategy-white-paper",
    publishedAt: "2025-02-11",
    featured: false,
  },
  {
    id: "modern-intranet-webinar",
    slug: "modern-intranet-webinar",
    type: "webinar",
    title: "Designing the Modern Intranet",
    description:
      "A webinar covering the patterns, governance, and content strategies behind intranets that employees actually use.",
    heroImage: "/images/home/feed/feed-4-digital-workplace.jpg",
    pillar: "experiences",
    tags: ["Intranet", "Digital Workplace"],
    url: "/webinars/modern-intranet-webinar",
    publishedAt: "2025-04-09",
    featured: false,
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  {
    id: "orion-ai-model",
    slug: "orion-ai-model",
    type: "model",
    title: "Orion: Strategy-to-Execution Model",
    description:
      "The Orion model maps strategy through to execution rhythms, with checkpoints and accountability artifacts at every layer.",
    heroImage: "/images/home/feed/feed-2-strategy-dialogues.jpeg",
    pillar: "strategic",
    tags: ["Models", "Strategy", "Operating Model"],
    url: "/library/orion-ai-model",
    publishedAt: "2025-01-22",
    featured: false,
  },
  {
    id: "ai-academy-immersive-ai-leadership-day",
    slug: "ai-academy-immersive-ai-leadership-day",
    type: "training",
    title: "AI Academy — Immersive AI Leadership Day",
    description:
      "A leadership session that cuts through AI hype, builds shared understanding, and identifies practical, high-impact opportunities tailored to your business.",
    heroImage: "/images/workshops/ai-academy-immersive-ai-leadership-day.jpg",
    pillar: "technology",
    tags: ["Workshop", "AI", "Leadership"],
    url: "/workshops/ai-academy-immersive-ai-leadership-day",
    publishedAt: "2025-05-01",
    featured: false,
  },
];

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function sortByPublishedDesc(a: Collateral, b: Collateral) {
  return b.publishedAt.localeCompare(a.publishedAt);
}

export interface ListOptions {
  type?: CollateralType[];
  pillar?: Pillar[];
  /** Case-insensitive substring match against tags. */
  topic?: string;
  featured?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  items: Collateral[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchFeatured(): Promise<Collateral[]> {
  const items = DATA.filter((c) => c.featured).sort(
    (a, b) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999),
  );
  return delay(items);
}

export async function fetchLibrary(options: ListOptions = {}): Promise<ListResult> {
  const {
    type = [],
    pillar = [],
    topic,
    featured,
    page = 1,
    pageSize = 12,
  } = options;

  let items = DATA.slice();
  if (type.length) items = items.filter((c) => type.includes(c.type));
  if (pillar.length) items = items.filter((c) => c.pillar && pillar.includes(c.pillar));
  if (topic && topic.trim()) {
    const needle = topic.trim().toLowerCase();
    items = items.filter((c) => c.tags.some((t) => t.toLowerCase().includes(needle)));
  }
  if (featured) {
    items = items
      .filter((c) => c.featured)
      .sort((a, b) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999));
  } else {
    items.sort(sortByPublishedDesc);
  }

  const total = items.length;
  const start = (page - 1) * pageSize;
  return delay({
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  });
}

export async function fetchCollateralBySlug(slug: string): Promise<Collateral | null> {
  return delay(DATA.find((c) => c.slug === slug) ?? null);
}

/** All available filter facet values, in display order. */
export function getTypeFacets(): CollateralType[] {
  return [
    "white_paper",
    "webinar",
    "case_study",
    "podcast",
    "model",
    "training",
    "event",
    "insight",
  ];
}

export function getPillarFacets(): Pillar[] {
  return ["strategic", "technology", "experiences", "gtm"];
}
