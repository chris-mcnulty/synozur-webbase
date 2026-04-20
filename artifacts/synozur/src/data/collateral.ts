/**
 * Public collateral library — live data layer.
 *
 * The four exported async helpers call the real backend endpoints:
 *   GET /api/collateral/featured
 *   GET /api/collateral
 *   GET /api/collateral/:slug
 *
 * All consuming pages (home carousel, library, webinars, items, and the three
 * detail pages) import only these helpers, so the swap is non-invasive.
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

export interface ListOptions {
  type?: CollateralType[];
  pillar?: Pillar[];
  /** Case-insensitive substring match against tags. */
  topic?: string;
  /** Case-insensitive substring match against title, subtitle, description, and tags. */
  q?: string;
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

const BASE_PATH = (
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/"
).replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

export async function fetchFeatured(): Promise<Collateral[]> {
  const res = await fetch(apiUrl("/collateral/featured"));
  if (!res.ok) throw new Error(`Failed to fetch featured collateral: ${res.status}`);
  return (await res.json()) as Collateral[];
}

export async function fetchLibrary(options: ListOptions = {}): Promise<ListResult> {
  const {
    type = [],
    pillar = [],
    topic,
    q,
    featured,
    page = 1,
    pageSize = 12,
  } = options;

  const params = new URLSearchParams();
  if (type.length) params.set("type", type.join(","));
  if (pillar.length) params.set("pillar", pillar.join(","));
  if (topic && topic.trim()) params.set("topic", topic.trim());
  if (q && q.trim()) params.set("q", q.trim());
  if (featured) params.set("featured", "true");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const res = await fetch(apiUrl(`/collateral?${params.toString()}`));
  if (!res.ok) throw new Error(`Failed to fetch collateral library: ${res.status}`);
  return (await res.json()) as ListResult;
}

export async function fetchCollateralBySlug(slug: string): Promise<Collateral | null> {
  const res = await fetch(apiUrl(`/collateral/${encodeURIComponent(slug)}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch collateral item: ${res.status}`);
  return (await res.json()) as Collateral;
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
