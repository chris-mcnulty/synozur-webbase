// #170 — Public search client. Manual fetch wrapper rather than orval-generated
// because the search response shape (excerptHtml + nullable searchId) is bespoke
// and a new OpenAPI codegen pass would churn unrelated generated files.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export const SEARCH_KINDS = [
  "post",
  "case_study",
  "white_paper",
  "service",
  "solution",
  "faq",
  "polaris_episode",
  "application",
  "model",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_LABELS: Record<SearchKind, string> = {
  post: "Insights",
  case_study: "Case studies",
  white_paper: "White papers",
  service: "Services",
  solution: "Solutions",
  faq: "FAQ",
  polaris_episode: "Polaris",
  application: "Applications",
  model: "Models",
};

export interface SearchResult {
  kind: SearchKind;
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  excerptHtml: string;
  rankScore: number;
  url: string;
}

export interface SearchResponse {
  items: SearchResult[];
  nextCursor: string | null;
  searchId: string | null;
  boosts: Record<string, number>;
}

export interface SearchAnalytics {
  days: number;
  totals: {
    total: number;
    clicked: number;
    zero: number;
    clickThroughRate: number;
    zeroResultRate: number;
  };
  zeroResultQueries: Array<{ query: string; count: number }>;
  topQueries: Array<{ query: string; count: number }>;
  topClickedKinds: Array<{ kind: SearchKind | null; count: number }>;
}

export interface SearchOptions {
  q: string;
  kind?: SearchKind | "all";
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export async function fetchSearch({ q, kind, limit, cursor, signal }: SearchOptions): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (kind && kind !== "all") params.set("kind", kind);
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${BASE_PATH}/api/search?${params.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return (await res.json()) as SearchResponse;
}

export async function reportSearchClick(input: {
  searchId: string;
  clickedKind: SearchKind;
  clickedRank: number;
  clickedSlug: string;
}): Promise<void> {
  try {
    await fetch(`${BASE_PATH}/api/search/click`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch {
    // Telemetry is best-effort; don't break navigation if it fails.
  }
}

export interface KindBoostsPayload {
  boosts: Record<SearchKind, number>;
  defaults: Record<SearchKind, number>;
}

export async function fetchSearchKindBoosts(): Promise<KindBoostsPayload> {
  const res = await fetch(`${BASE_PATH}/api/cms/search-kind-boosts`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Boosts fetch failed: ${res.status}`);
  return (await res.json()) as KindBoostsPayload;
}

export async function updateSearchKindBoosts(
  boosts: Partial<Record<SearchKind, number>>,
): Promise<{ boosts: Record<SearchKind, number> }> {
  const res = await fetch(`${BASE_PATH}/api/cms/search-kind-boosts`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ boosts }),
  });
  if (!res.ok) throw new Error(`Boosts update failed: ${res.status}`);
  return (await res.json()) as { boosts: Record<SearchKind, number> };
}

export async function fetchSearchAnalytics(days = 30): Promise<SearchAnalytics> {
  const res = await fetch(`${BASE_PATH}/api/cms/search-analytics?days=${days}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Search analytics failed: ${res.status}`);
  return (await res.json()) as SearchAnalytics;
}
