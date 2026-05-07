import { portalFetch } from "@/lib/portal-fetch";

// ── Shared types (mirror Constellation's projected shapes) ────────────────────

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

export interface CPage<T> {
  items: T[];
  nextCursor: string | null;
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
  ragStatus: "green" | "amber" | "red" | string;
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

// ── Mutation helpers (POST with JSON body) ────────────────────────────────────

async function portalPost<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(`${window.location.origin}/api${path}`);
  const { getOauthClient } = await import("@/lib/oauthClient");
  const token = await getOauthClient().getAccessToken().catch(() => null);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  return res.json() as Promise<T>;
}

// ── API surface ───────────────────────────────────────────────────────────────

export const constellationApi = {
  // Projects
  listProjects: (params?: { status?: string; limit?: number; cursor?: string }) =>
    portalFetch<CPage<CProject>>("/portal/constellation/projects", params as Record<string, string | number>),

  getProject: (id: string) =>
    portalFetch<CProject>(`/portal/constellation/projects/${id}`),

  // Status reports
  listStatusReports: (projectId: string, params?: { limit?: number; cursor?: string }) =>
    portalFetch<CPage<CStatusReport>>(`/portal/constellation/projects/${projectId}/status-reports`, params as Record<string, string | number>),

  acknowledgeStatusReport: (reportId: string, comment?: string) =>
    portalPost<{ signoff: CSignoff }>(`/portal/constellation/status-reports/${reportId}/acknowledge`, { comment }),

  // Milestones
  listMilestones: (projectId: string, params?: { status?: string; limit?: number; cursor?: string }) =>
    portalFetch<CPage<CMilestone>>(`/portal/constellation/projects/${projectId}/milestones`, params as Record<string, string | number>),

  acceptMilestone: (milestoneId: string, comment?: string) =>
    portalPost<{ signoff: CSignoff }>(`/portal/constellation/milestones/${milestoneId}/accept`, { comment }),

  rejectMilestone: (milestoneId: string, comment?: string) =>
    portalPost<{ signoff: CSignoff }>(`/portal/constellation/milestones/${milestoneId}/reject`, { comment }),

  // Estimates
  getEstimate: (estimateId: string) =>
    portalFetch<CEstimate>(`/portal/constellation/estimates/${estimateId}`),

  approveEstimate: (estimateId: string, comment?: string) =>
    portalPost<{ signoff: CSignoff; estimate: CEstimate }>(`/portal/constellation/estimates/${estimateId}/approve`, { comment }),

  requestEstimateChanges: (estimateId: string, comment?: string) =>
    portalPost<{ signoff: CSignoff }>(`/portal/constellation/estimates/${estimateId}/request-changes`, { comment }),

  // Invoices
  listInvoices: (params?: { limit?: number; cursor?: string }) =>
    portalFetch<CPage<CInvoice>>("/portal/constellation/invoices", params as Record<string, string | number>),

  // RAIDD
  listRaidd: (projectId: string, params?: { limit?: number; cursor?: string }) =>
    portalFetch<CPage<CRaidd>>(`/portal/constellation/projects/${projectId}/raidd`, params as Record<string, string | number>),

  commentOnRaidd: (raiddId: string, comment: string) =>
    portalPost<{ comment: { id: string; raiddId: string; comment: string; createdAt: string } }>(
      `/portal/constellation/raidd/${raiddId}/comments`,
      { comment },
    ),
};
