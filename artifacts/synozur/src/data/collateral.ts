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
  | "insight"
  | "application";

export type Pillar =
  | "strategic"
  | "technology"
  | "experiences"
  | "gtm";

/**
 * #122 — Companion files attached to a library item.
 *
 * `mediaId` set ⇒ media-backed (uploaded asset); `externalUrl` set ⇒
 * off-platform link (GitHub, Figma, vendor CDN). The `url` field is the
 * resolved URL the client renders — server picks `media.publicUrl` or the
 * external URL automatically.
 */
export interface CollateralResource {
  id: string;
  collateralId: string;
  mediaId: string | null;
  externalUrl: string | null;
  label: string;
  mimeType: string | null;
  sortOrder: number;
  url: string;
  createdAt: string;
  updatedAt: string;
}

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
  /**
   * Mirror of the first `resources` row, kept for back-compat with carousel
   * cards that need a single primary CTA without loading the full resources
   * array. Server-derived; do not write directly.
   */
  downloadUrl?: string;
  /**
   * Companion files (slides, transcript, code repo, etc.). Populated only by
   * the by-slug endpoint — list endpoints omit this for payload size.
   */
  resources?: CollateralResource[];
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
  application: "APPLICATION",
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
  /** Foreign key filter — matches `collateral.service_id`. Replaces the pillar heuristic (#100). */
  serviceId?: string;
  /** Foreign key filter — matches `collateral.solution_id`. */
  solutionId?: string;
  /**
   * When true, only returns rows where `solution_id` is NULL.
   * Used by the parent-service fallback on solution pages so sibling-solution
   * items don't bleed through.
   */
  solutionIdIsNull?: boolean;
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
    serviceId,
    solutionId,
    solutionIdIsNull,
    topic,
    q,
    featured,
    page = 1,
    pageSize = 12,
  } = options;

  const params = new URLSearchParams();
  if (type.length) params.set("type", type.join(","));
  if (pillar.length) params.set("pillar", pillar.join(","));
  if (serviceId) params.set("serviceId", serviceId);
  if (solutionId) params.set("solutionId", solutionId);
  if (solutionIdIsNull) params.set("solutionIdIsNull", "true");
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
    "application",
  ];
}

export function getPillarFacets(): Pillar[] {
  return ["strategic", "technology", "experiences", "gtm"];
}
