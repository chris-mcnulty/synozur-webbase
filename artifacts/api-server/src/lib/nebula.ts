import { logger } from "./logger";

const NEBULA_BASE = (process.env.NEBULA_BASE_URL ?? "").replace(/\/$/, "");
const NEBULA_KEY = process.env.NEBULA_API_KEY ?? "";

// ── In-memory cache ────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}
function setCached<T>(key: string, data: T, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── HTTP client ────────────────────────────────────────────────────────────

export class NebulaError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "NebulaError";
  }
}

async function nebulaFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  if (!NEBULA_BASE || !NEBULA_KEY) {
    throw new NebulaError(503, "Nebula integration not configured (NEBULA_BASE_URL / NEBULA_API_KEY missing)");
  }
  const url = new URL(`${NEBULA_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${NEBULA_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, path, body }, "nebula api error");
      throw new NebulaError(res.status, `Nebula API ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────

const TTL_LIST = 60_000;       // 60 s for list endpoints
const TTL_REPORT = 5 * 60_000; // 5 min for individual reports

export const nebula = {
  listReports: async (params?: { page?: string; limit?: string; domain?: string }): Promise<NebulaReportsPage> => {
    const p: Record<string, string> = {};
    if (params?.page) p.page = params.page;
    if (params?.limit) p.limit = params.limit;
    if (params?.domain) p.domain = params.domain;
    const cacheKey = `reports:${JSON.stringify(p)}`;
    const hit = getCached<NebulaReportsPage>(cacheKey);
    if (hit) return hit;
    const data = await nebulaFetch<NebulaReportsPage>("/api/galaxy/reports", p);
    setCached(cacheKey, data, TTL_LIST);
    return data;
  },

  getReport: async (spaceId: string): Promise<NebulaReport> => {
    const cacheKey = `report:${spaceId}`;
    const hit = getCached<NebulaReport>(cacheKey);
    if (hit) return hit;
    const data = await nebulaFetch<NebulaReport>(`/api/galaxy/reports/${spaceId}`);
    setCached(cacheKey, data, TTL_REPORT);
    return data;
  },

  listWorkspaces: async (params?: { domain?: string }): Promise<NebulaWorkspacesResponse> => {
    const p: Record<string, string> = {};
    if (params?.domain) p.domain = params.domain;
    const cacheKey = `workspaces:${JSON.stringify(p)}`;
    const hit = getCached<NebulaWorkspacesResponse>(cacheKey);
    if (hit) return hit;
    const data = await nebulaFetch<NebulaWorkspacesResponse>("/api/galaxy/workspaces", p);
    setCached(cacheKey, data, TTL_LIST);
    return data;
  },
};
