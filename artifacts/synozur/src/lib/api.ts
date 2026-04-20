import type {
  PublicEvent,
  AdminEvent,
  Asset,
  EventInput,
  AssetInput,
  ContactFormInput,
  SubscribeFormInput,
  StartFormInput,
  FormSubmissionAck,
  AdminFormSubmissionsPage,
} from "@workspace/api-zod/types";

export interface SubmissionsQuery {
  formType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

function submissionsQueryString(q: SubmissionsQuery): string {
  const params = new URLSearchParams();
  if (q.formType) params.set("formType", q.formType);
  if (q.search) params.set("search", q.search);
  if (q.page) params.set("page", String(q.page));
  if (q.pageSize) params.set("pageSize", String(q.pageSize));
  const s = params.toString();
  return s ? `?${s}` : "";
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function url(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function jsonFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const obj = (body && typeof body === "object") ? (body as Record<string, unknown>) : null;
    const detail = obj && "error" in obj ? String(obj["error"]) : res.statusText;
    const code = obj && typeof obj["code"] === "string" ? (obj["code"] as string) : null;
    throw new ApiError(`${res.status} ${detail}`, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AdminMe {
  userId: string;
  email: string;
  authorized: boolean;
}

export interface PublicSiteSettings {
  requireCookieConsent: boolean;
}

export interface AdminSiteSettings {
  requireCookieConsent: boolean;
  updatedAt: string;
}

export interface ServiceDto {
  id: string;
  slug: string;
  title: string;
  displayOrder: number | null;
  parentServiceId: string | null;
  iconId: string | null;
  iconUrl: string | null;
  servicePath: string | null;
  overviewPath: string | null;
  buttonText: string | null;
  heroTextHtml: string | null;
  secondaryTitle: string | null;
  secondaryTextHtml: string | null;
  tertiaryTitle: string | null;
  tertiaryTextHtml: string | null;
  blurbHtml: string | null;
  blogCategory: string | null;
  active: boolean;
}

export interface SolutionDto {
  id: string;
  slug: string;
  title: string;
  displayOrder: number | null;
  parentServiceId: string | null;
  iconId: string | null;
  iconUrl: string | null;
  routePath: string | null;
  buttonText: string | null;
  heroTextHtml: string | null;
  secondaryTitle: string | null;
  secondaryTextHtml: string | null;
  ourApproachTitle: string | null;
  ourApproachTextHtml: string | null;
  blurbHtml: string | null;
  blurbCopy: string | null;
  heroTextColor: string | null;
  tagsText: string | null;
  active: boolean;
}

export interface MethodologyDto {
  id: string;
  serviceId: string;
  title: string;
  displayOrder: number;
  iconId: string | null;
  iconUrl: string | null;
  bodyHtml: string | null;
  hidden: boolean;
}

export interface CapabilityDto {
  id: string;
  solutionId: string;
  title: string;
  displayOrder: number;
  iconId: string | null;
  iconUrl: string | null;
  bodyHtml: string | null;
  hidden: boolean;
}

export type ServiceWithSolutions = ServiceDto & { solutions: SolutionDto[] };
export type ServiceWithMethodologies = ServiceDto & { methodologies: MethodologyDto[] };
export type SolutionWithCapabilities = SolutionDto & {
  parentService: ServiceDto | null;
  capabilities: CapabilityDto[];
};

export const api = {
  listServices: () => jsonFetch<{ items: ServiceWithSolutions[] }>(url("/services")),
  getService: (slug: string) =>
    jsonFetch<ServiceWithMethodologies>(url(`/services/${encodeURIComponent(slug)}`)),
  getSolution: (slug: string) =>
    jsonFetch<SolutionWithCapabilities>(url(`/solutions/${encodeURIComponent(slug)}`)),
  publicEvents: () => jsonFetch<PublicEvent[]>(url("/events")),
  me: () => jsonFetch<AdminMe>(url("/admin/me")),
  adminEvents: () => jsonFetch<AdminEvent[]>(url("/admin/events")),
  getEvent: (id: number) => jsonFetch<AdminEvent>(url(`/admin/events/${id}`)),
  createEvent: (body: EventInput) =>
    jsonFetch<AdminEvent>(url("/admin/events"), { method: "POST", body: JSON.stringify(body) }),
  updateEvent: (id: number, body: EventInput) =>
    jsonFetch<AdminEvent>(url(`/admin/events/${id}`), { method: "PATCH", body: JSON.stringify(body) }),
  deleteEvent: (id: number) => jsonFetch<void>(url(`/admin/events/${id}`), { method: "DELETE" }),
  listAssets: (search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    return jsonFetch<Asset[]>(url(`/assets${q}`));
  },
  createAsset: (body: AssetInput) =>
    jsonFetch<Asset>(url("/assets"), { method: "POST", body: JSON.stringify(body) }),
  deleteAsset: (id: number) => jsonFetch<void>(url(`/assets/${id}`), { method: "DELETE" }),
  requestUploadUrl: (body: { name: string; size: number; contentType: string }) =>
    jsonFetch<{ uploadURL: string; objectPath: string }>(url("/storage/uploads/request-url"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitContact: (body: ContactFormInput) =>
    jsonFetch<FormSubmissionAck>(url("/forms/contact"), { method: "POST", body: JSON.stringify(body) }),
  submitSubscribe: (body: SubscribeFormInput) =>
    jsonFetch<FormSubmissionAck>(url("/forms/subscribe"), { method: "POST", body: JSON.stringify(body) }),
  submitStart: (body: StartFormInput) =>
    jsonFetch<FormSubmissionAck>(url("/forms/start"), { method: "POST", body: JSON.stringify(body) }),
  listSubmissions: (q: SubmissionsQuery = {}) =>
    jsonFetch<AdminFormSubmissionsPage>(url(`/admin/forms/submissions${submissionsQueryString(q)}`)),
  submissionsCsvUrl: (q: Pick<SubmissionsQuery, "formType" | "search"> = {}) =>
    url(`/admin/forms/submissions.csv${submissionsQueryString(q)}`),
  getPublicSiteSettings: () => jsonFetch<PublicSiteSettings>(url("/site-settings")),
  getAdminSiteSettings: () => jsonFetch<AdminSiteSettings>(url("/admin/site-settings")),
  updateAdminSiteSettings: (body: { requireCookieConsent: boolean }) =>
    jsonFetch<AdminSiteSettings>(url("/admin/site-settings"), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
