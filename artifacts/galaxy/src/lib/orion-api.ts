import { portalFetch } from "@/lib/portal-fetch";

export interface OrionModel {
  id: string;
  name: string;
  description: string;
  slug: string;
  dimensionCount: number;
  questionCount: number;
  avgScore?: number | null;
  tenantId: string;
}

export interface OrionCourse {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  thumbnail: string | null;
  estimatedMinutes: number;
  moduleCount: number;
  tags: string[];
}

export interface OrionScoreDistributionEntry {
  level: string;
  count: number;
  percentage: number | null;
}

export interface OrionResultEntry {
  modelId: string;
  modelName: string;
  avgScore: number | null;
  responseCount: number | null;
  scoreDistribution: OrionScoreDistributionEntry[];
}

export const orionApi = {
  getModels: () => portalFetch<OrionModel[]>("/portal/orion/models"),
  getCourses: () => portalFetch<OrionCourse[]>("/portal/orion/courses"),
  getResults: () => portalFetch<OrionResultEntry[]>("/portal/orion/results"),
};
