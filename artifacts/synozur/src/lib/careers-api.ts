// #223 — Careers client. Direct fetch (mirrors api.ts pattern). Not yet
// generated through the OpenAPI spec; types are defined locally so the
// careers section can ship without a full codegen regen of the 7000-line
// api-spec — see commit message for the deviation note.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function url(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

async function jsonFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CareersJob {
  id: string;
  slug: string;
  requisitionNumber: string;
  title: string;
  department: string;
  location: string;
  employmentType: "full_time" | "part_time" | "contract" | "internship";
  status: "draft" | "published" | "closed";
  description: string;
  descriptionParagraphs: string[];
  requirementsParagraphs: string[];
  salaryRange: string | null;
  hiringManagerEmail: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CareersApplication {
  id: string;
  jobPostingId: string | null;
  applicantUserId: string;
  fullName: string;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  education: string | null;
  experience: string | null;
  coverLetter: string | null;
  workAuthorized: boolean | null;
  requireSponsorship: boolean | null;
  eeoRace: string | null;
  eeoGender: string | null;
  eeoVeteran: string | null;
  eeoDisability: string | null;
  gdprConsent: boolean;
  resumeMediaId: string | null;
  status: "new" | "reviewing" | "interview" | "offer" | "rejected";
  aiMatchScore: number | null;
  aiMatchReasoning: string | null;
  aiScoredAt: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface CareersSettings {
  mode: "native" | "redirect";
  externalUrl: string | null;
  eeoEnabled: boolean;
  defaultHiringManager: string | null;
}

export interface ApplicationDetail {
  application: CareersApplication;
  job: { id: string; slug: string; title: string; requisitionNumber: string } | null;
  applicant: { id: string; email: string; displayName: string | null } | null;
  resume: { id: string; publicUrl: string | null; originalName: string | null } | null;
  notes: {
    id: string;
    applicationId: string;
    authorId: string | null;
    body: string;
    createdAt: string;
  }[];
}

export const careersApi = {
  // Public
  listJobs: () =>
    jsonFetch<{ items: CareersJob[] }>(url("/careers/jobs")),
  getJob: (slug: string) => jsonFetch<CareersJob>(url(`/careers/jobs/${slug}`)),
  getSettings: () => jsonFetch<CareersSettings>(url("/careers/settings")),
  submitApplication: (body: Record<string, unknown>) =>
    jsonFetch<{ id: string; status: string }>(url("/careers/applications"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  myApplications: () =>
    jsonFetch<{ items: CareersApplication[] }>(url("/careers/my-applications")),

  // Admin
  adminListJobs: () =>
    jsonFetch<{ items: CareersJob[] }>(url("/cms/careers/jobs")),
  adminGetJob: (id: string) =>
    jsonFetch<CareersJob>(url(`/cms/careers/jobs/${id}`)),
  adminCreateJob: (body: Record<string, unknown>) =>
    jsonFetch<CareersJob>(url("/cms/careers/jobs"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminPatchJob: (id: string, body: Record<string, unknown>) =>
    jsonFetch<CareersJob>(url(`/cms/careers/jobs/${id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeleteJob: (id: string) =>
    jsonFetch<void>(url(`/cms/careers/jobs/${id}`), { method: "DELETE" }),
  adminNextRequisition: () =>
    jsonFetch<{ requisitionNumber: string }>(url("/cms/careers/next-requisition")),

  adminListApplications: (q?: { status?: string; jobId?: string }) => {
    const p = new URLSearchParams();
    if (q?.status) p.set("status", q.status);
    if (q?.jobId) p.set("jobId", q.jobId);
    const qs = p.toString() ? `?${p.toString()}` : "";
    return jsonFetch<{ items: CareersApplication[] }>(
      url(`/cms/careers/applications${qs}`),
    );
  },
  adminGetApplication: (id: string) =>
    jsonFetch<ApplicationDetail>(url(`/cms/careers/applications/${id}`)),
  adminPatchApplication: (id: string, body: Record<string, unknown>) =>
    jsonFetch<CareersApplication>(url(`/cms/careers/applications/${id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminAddNote: (id: string, body: string) =>
    jsonFetch<{ id: string; body: string; createdAt: string }>(
      url(`/cms/careers/applications/${id}/notes`),
      { method: "POST", body: JSON.stringify({ body }) },
    ),
  adminRescore: (id: string) =>
    jsonFetch<{ score: number; reasoning: string }>(
      url(`/cms/careers/applications/${id}/rescore`),
      { method: "POST" },
    ),
  adminEeoSummary: () =>
    jsonFetch<{
      total: number;
      race: Record<string, number>;
      gender: Record<string, number>;
      veteran: Record<string, number>;
    }>(url("/cms/careers/applications/eeo-summary")),

  adminGetSettings: () =>
    jsonFetch<CareersSettings>(url("/cms/careers/settings")),
  adminPatchSettings: (body: Partial<CareersSettings>) =>
    jsonFetch<CareersSettings>(url("/cms/careers/settings"), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
