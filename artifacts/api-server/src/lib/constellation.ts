import { logger } from "./logger";

const CONSTELLATION_BASE = (process.env.CONSTELLATION_BASE_URL ?? "").replace(/\/$/, "");
const CLIENT_ID = process.env.CONSTELLATION_GALAXY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.CONSTELLATION_GALAXY_CLIENT_SECRET ?? "";

// ── Token cache — one access token per target_client_id ──────────────────────
// Each token lives 15 min (per Constellation's ACCESS_TTL_SECONDS). We refresh
// 60 s early to avoid serving stale tokens near the expiry boundary.

interface TokenEntry {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, TokenEntry>();

async function fetchClientCredentialsToken(targetClientId: string): Promise<string> {
  const url = `${CONSTELLATION_BASE}/api/galaxy/v1/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    target_client_id: targetClientId,
    scope: [
      "projects:read",
      "milestones:read",
      "milestones:accept",
      "status_reports:read",
      "status_reports:acknowledge",
      "estimates:read",
      "estimates:approve",
      "invoices:read",
      "raidd:read",
      "raidd:comment",
      "documents:read",
    ].join(" "),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, body: text, targetClientId }, "constellation token fetch failed");
      throw new ConstellationError(res.status, `Token fetch failed: ${res.status}`);
    }
    const json = await res.json() as { access_token: string; expires_in: number };
    return json.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function getToken(targetClientId: string): Promise<string> {
  const entry = tokenCache.get(targetClientId);
  const earlyRefreshMs = 60_000;
  if (entry && Date.now() < entry.expiresAt - earlyRefreshMs) {
    return entry.token;
  }
  const token = await fetchClientCredentialsToken(targetClientId);
  // Constellation issues 900 s (15 min) tokens
  tokenCache.set(targetClientId, { token, expiresAt: Date.now() + 900_000 });
  return token;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class ConstellationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ConstellationError";
  }
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function constellationFetch<T>(
  targetClientId: string,
  path: string,
  opts?: { method?: string; params?: Record<string, string | number | undefined>; body?: unknown },
): Promise<T> {
  if (!CONSTELLATION_BASE || !CLIENT_ID || !CLIENT_SECRET) {
    throw new ConstellationError(
      503,
      "Constellation integration not configured (CONSTELLATION_BASE_URL / CONSTELLATION_GALAXY_CLIENT_ID / CONSTELLATION_GALAXY_CLIENT_SECRET missing)",
    );
  }
  const token = await getToken(targetClientId);
  const url = new URL(`${CONSTELLATION_BASE}/api/galaxy/v1${path}`);
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), {
      method: opts?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, path, targetClientId, body: text }, "constellation api error");
      throw new ConstellationError(res.status, `Constellation API ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// ── In-memory read cache (short TTL) ─────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number; }
const readCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = readCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { readCache.delete(key); return null; }
  return entry.data;
}
function setCached<T>(key: string, data: T, ttlMs: number) {
  readCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const TTL_LIST = 90_000;    // 90 s for list endpoints
const TTL_DETAIL = 60_000;  // 60 s for detail endpoints

// ── Response shapes ───────────────────────────────────────────────────────────

export interface ConstellationPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CProject {
  id: string;
  code: string | null;
  name: string;
  clientId: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  pmName: string | null;
  healthStatus: string | null;
}

export interface CMilestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  type: "payment" | "delivery";
  targetDate: string | null;
  completedDate: string | null;
  clientFacingStatus: string;
  amount: number | null;
}

export interface CStatusReport {
  id: string;
  projectId: string;
  reportPeriod: string;
  ragStatus: string;
  accomplishments: string | null;
  milestones: string | null;
  risks: string | null;
  notes: string | null;
  publishedAt: string;
}

export interface CEstimate {
  id: string;
  name: string;
  clientId: string;
  projectId: string | null;
  status: string;
  estimateType: string;
  presentedTotal: number | null;
  validUntil: string | null;
  estimateDate: string | null;
  proposalNarrative: string | null;
  createdAt: string;
}

export interface CInvoice {
  id: string;
  batchId: string;
  glInvoiceNumber: string | null;
  startDate: string;
  endDate: string;
  totalAmount: number | null;
  taxAmount: number | null;
  paymentStatus: string;
  paymentDate: string | null;
  paymentTerms: string | null;
  finalizedAt: string | null;
  pdfDownloadUrl: string | null;
}

export interface CRaidd {
  id: string;
  projectId: string;
  type: string;
  refNumber: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
}

export interface CSignoff {
  id: string;
  signedAt: string;
  action: string;
  comment: string | null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const constellation = {
  // Projects
  listProjects: async (clientId: string, params?: { status?: string; limit?: number; cursor?: string }): Promise<ConstellationPage<CProject>> => {
    const key = `projects:${clientId}:${JSON.stringify(params ?? {})}`;
    const hit = getCached<ConstellationPage<CProject>>(key);
    if (hit) return hit;
    const data = await constellationFetch<ConstellationPage<CProject>>(clientId, "/projects", { params: params as Record<string, string | number | undefined> });
    setCached(key, data, TTL_LIST);
    return data;
  },

  getProject: async (clientId: string, projectId: string): Promise<CProject> => {
    const key = `project:${clientId}:${projectId}`;
    const hit = getCached<CProject>(key);
    if (hit) return hit;
    const data = await constellationFetch<CProject>(clientId, `/projects/${projectId}`);
    setCached(key, data, TTL_DETAIL);
    return data;
  },

  // Status reports
  listStatusReports: async (clientId: string, projectId: string, params?: { limit?: number; cursor?: string }): Promise<ConstellationPage<CStatusReport>> => {
    const key = `status-reports:${clientId}:${projectId}:${JSON.stringify(params ?? {})}`;
    const hit = getCached<ConstellationPage<CStatusReport>>(key);
    if (hit) return hit;
    const data = await constellationFetch<ConstellationPage<CStatusReport>>(clientId, `/projects/${projectId}/status-reports`, { params: params as Record<string, string | number | undefined> });
    setCached(key, data, TTL_LIST);
    return data;
  },

  acknowledgeStatusReport: async (clientId: string, reportId: string, comment?: string): Promise<{ signoff: CSignoff }> => {
    return constellationFetch(clientId, `/status-reports/${reportId}/acknowledge`, { method: "POST", body: { comment } });
  },

  // Milestones
  listMilestones: async (clientId: string, projectId: string, params?: { status?: string; limit?: number; cursor?: string }): Promise<ConstellationPage<CMilestone>> => {
    const key = `milestones:${clientId}:${projectId}:${JSON.stringify(params ?? {})}`;
    const hit = getCached<ConstellationPage<CMilestone>>(key);
    if (hit) return hit;
    const data = await constellationFetch<ConstellationPage<CMilestone>>(clientId, `/projects/${projectId}/milestones`, { params: params as Record<string, string | number | undefined> });
    setCached(key, data, TTL_LIST);
    return data;
  },

  acceptMilestone: async (clientId: string, milestoneId: string, comment?: string): Promise<{ signoff: CSignoff }> => {
    return constellationFetch(clientId, `/milestones/${milestoneId}/accept`, { method: "POST", body: { comment } });
  },

  rejectMilestone: async (clientId: string, milestoneId: string, comment?: string): Promise<{ signoff: CSignoff }> => {
    return constellationFetch(clientId, `/milestones/${milestoneId}/reject`, { method: "POST", body: { comment } });
  },

  // Estimates
  getEstimate: async (clientId: string, estimateId: string): Promise<CEstimate> => {
    const key = `estimate:${clientId}:${estimateId}`;
    const hit = getCached<CEstimate>(key);
    if (hit) return hit;
    const data = await constellationFetch<CEstimate>(clientId, `/estimates/${estimateId}`);
    setCached(key, data, TTL_DETAIL);
    return data;
  },

  approveEstimate: async (clientId: string, estimateId: string, comment?: string): Promise<{ signoff: CSignoff; estimate: CEstimate }> => {
    return constellationFetch(clientId, `/estimates/${estimateId}/approve`, { method: "POST", body: { comment } });
  },

  requestEstimateChanges: async (clientId: string, estimateId: string, comment?: string): Promise<{ signoff: CSignoff }> => {
    return constellationFetch(clientId, `/estimates/${estimateId}/request-changes`, { method: "POST", body: { comment } });
  },

  // Invoices
  listInvoices: async (clientId: string, params?: { limit?: number; cursor?: string }): Promise<ConstellationPage<CInvoice>> => {
    const key = `invoices:${clientId}:${JSON.stringify(params ?? {})}`;
    const hit = getCached<ConstellationPage<CInvoice>>(key);
    if (hit) return hit;
    const data = await constellationFetch<ConstellationPage<CInvoice>>(clientId, "/invoices", { params: params as Record<string, string | number | undefined> });
    setCached(key, data, TTL_LIST);
    return data;
  },

  // RAIDD
  listRaidd: async (clientId: string, projectId: string, params?: { limit?: number; cursor?: string }): Promise<ConstellationPage<CRaidd>> => {
    const key = `raidd:${clientId}:${projectId}:${JSON.stringify(params ?? {})}`;
    const hit = getCached<ConstellationPage<CRaidd>>(key);
    if (hit) return hit;
    const data = await constellationFetch<ConstellationPage<CRaidd>>(clientId, `/projects/${projectId}/raidd`, { params: params as Record<string, string | number | undefined> });
    setCached(key, data, TTL_LIST);
    return data;
  },

  commentOnRaidd: async (clientId: string, raiddId: string, comment: string): Promise<{ comment: { id: string; raiddId: string; comment: string; createdAt: string } }> => {
    return constellationFetch(clientId, `/raidd/${raiddId}/comments`, { method: "POST", body: { comment } });
  },

  // Cache invalidation for after mutations
  bustCache: (clientId: string, prefix?: string) => {
    const matchPrefix = prefix ? `${prefix}:${clientId}` : clientId;
    for (const k of readCache.keys()) {
      if (k.includes(matchPrefix)) readCache.delete(k);
    }
  },
};
