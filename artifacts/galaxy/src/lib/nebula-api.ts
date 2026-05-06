// The api-server is mounted at /api by the path-based reverse proxy, NOT
// under the Galaxy /galaxy/ base path. Always call /api/... directly.
async function apiFetch<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${window.location.origin}/api${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export interface NebulaReportSummary {
  spaceId: string;
  name: string;
  code: string;
  closedAt: string;
  reportGeneratedAt: string;
  summarySnippet: string;
}

export interface NebulaReportsPage {
  data: NebulaReportSummary[];
  page: number;
  limit: number;
  total: number;
}

export interface NebulaTopIdea {
  content: string;
  score: number;
}

export interface NebulaCategoryNote {
  id: string;
  content: string;
}

export interface NebulaCategory {
  id: string;
  name: string;
  color: string;
  noteCount: number;
  notes: NebulaCategoryNote[];
}

export interface NebulaReport {
  spaceId: string;
  name: string;
  code: string;
  status: string;
  closedAt: string | null;
  summary: string | null;
  keyThemes: string[] | null;
  topIdeas: NebulaTopIdea[] | null;
  insights: string | null;
  recommendations: string | null;
  categoryBreakdown: NebulaCategory[];
  uncategorisedNoteCount: number;
  generatedAt: string | null;
}

export interface NebulaWorkspace {
  id: string;
  name: string;
  code: string;
  status: "active" | "closed" | "archived";
  url: string;
  createdAt: string;
}

export interface NebulaWorkspacesResponse {
  data: NebulaWorkspace[];
}

export const nebulaApi = {
  listReports: (page = 1, limit = 20) =>
    apiFetch<NebulaReportsPage>("/portal/nebula/reports", { page, limit }),
  getReport: (spaceId: string) =>
    apiFetch<NebulaReport>(`/portal/nebula/reports/${spaceId}`),
  listWorkspaces: () =>
    apiFetch<NebulaWorkspacesResponse>("/portal/nebula/workspaces"),
};
