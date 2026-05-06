import { logger } from "./logger";

const ORION_BASE = (process.env.ORION_BASE_URL ?? "").replace(/\/$/, "");
const ORION_KEY = process.env.ORION_PORTAL_KEY ?? "";
const ORION_DOMAIN = process.env.ORION_DOMAIN ?? "synozur.com";

// ── In-memory cache ─────────────────────────────────────────────────────────

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

// ── HTTP client ──────────────────────────────────────────────────────────────

export class OrionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "OrionError";
  }
}

async function orionFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  if (!ORION_BASE || !ORION_KEY) {
    throw new OrionError(503, "Orion integration not configured (ORION_BASE_URL / ORION_PORTAL_KEY missing)");
  }
  const url = new URL(`${ORION_BASE}${path}`);
  url.searchParams.set("domain", ORION_DOMAIN);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `ApiKey ${ORION_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, path, body }, "orion api error");
      throw new OrionError(res.status, `Orion API ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface OrionTrafficStats {
  totalPageViews: number;
  uniqueSessions: number;
  assessmentsStarted: number;
  assessmentsCompleted: number;
  courseEnrollments: number;
  from: string;
  to: string;
}

// ── TTLs ────────────────────────────────────────────────────────────────────

const TTL = 5 * 60_000; // 5 min for all Orion list endpoints
const TTL_TRAFFIC = 60 * 60_000; // 1 hr for traffic (polled separately)

// ── Public API ───────────────────────────────────────────────────────────────

export const orion = {
  getModels: async (): Promise<OrionModel[]> => {
    const key = "models";
    const hit = getCached<OrionModel[]>(key);
    if (hit) return hit;
    const data = await orionFetch<OrionModel[]>("/api/galaxy/v1/portal/models");
    setCached(key, data, TTL);
    return data;
  },

  getCourses: async (): Promise<OrionCourse[]> => {
    const key = "courses";
    const hit = getCached<OrionCourse[]>(key);
    if (hit) return hit;
    const data = await orionFetch<OrionCourse[]>("/api/galaxy/v1/portal/courses");
    setCached(key, data, TTL);
    return data;
  },

  getResults: async (): Promise<OrionResultEntry[]> => {
    const key = "results";
    const hit = getCached<OrionResultEntry[]>(key);
    if (hit) return hit;
    const data = await orionFetch<OrionResultEntry[]>("/api/galaxy/v1/portal/results");
    setCached(key, data, TTL);
    return data;
  },

  getTraffic: async (from?: string, to?: string): Promise<OrionTrafficStats> => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    const key = `traffic:${from ?? ""}:${to ?? ""}`;
    const hit = getCached<OrionTrafficStats>(key);
    if (hit) return hit;
    const data = await orionFetch<OrionTrafficStats>("/api/galaxy/v1/portal/traffic", p);
    setCached(key, data, TTL_TRAFFIC);
    return data;
  },

  /** Bust the in-memory cache for a given key prefix (used by the traffic poller). */
  bustCache: (prefix: string) => {
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  },
};
