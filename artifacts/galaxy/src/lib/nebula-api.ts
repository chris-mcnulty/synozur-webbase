import { portalFetch } from "@/lib/portal-fetch";

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
    portalFetch<NebulaReportsPage>("/portal/nebula/reports", { page, limit }),
  getReport: (spaceId: string) =>
    portalFetch<NebulaReport>(`/portal/nebula/reports/${spaceId}`),
  listWorkspaces: () =>
    portalFetch<NebulaWorkspacesResponse>("/portal/nebula/workspaces"),
};
