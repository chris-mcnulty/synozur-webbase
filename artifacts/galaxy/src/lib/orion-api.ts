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

export interface OrionModel {
  id: string;
  name: string;
  description: string;
  slug: string;
  dimensionCount: number;
  questionCount: number;
  avgScore?: number;
  tenantId: string;
}

export interface OrionCourse {
  id: string;
  title: string;
  slug: string;
  description: string;
  thumbnail: string | null;
  estimatedMinutes: number;
  moduleCount: number;
  tags: string[];
}

export interface OrionScoreDistributionEntry {
  level: string;
  count: number;
  percentage: number;
}

export interface OrionResultEntry {
  modelId: string;
  modelName: string;
  avgScore: number;
  responseCount: number;
  scoreDistribution: OrionScoreDistributionEntry[];
}

export const orionApi = {
  getModels: () => apiFetch<OrionModel[]>("/portal/orion/models"),
  getCourses: () => apiFetch<OrionCourse[]>("/portal/orion/courses"),
  getResults: () => apiFetch<OrionResultEntry[]>("/portal/orion/results"),
};
