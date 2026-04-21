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
  AdminFormSubmission,
  AdminFormSubmissionsPage,
  PublicTeamMember,
  AdminTeamMember,
  TeamMemberInput,
  RetryFailedSubmissionsResult,
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
  homeHeroImageUrl?: string | null;
  homeEditorialImageUrl?: string | null;
}

export interface AdminSiteSettings {
  requireCookieConsent: boolean;
  homeHeroImageAssetId?: number | null;
  homeHeroImageUrl?: string | null;
  homeEditorialImageAssetId?: number | null;
  homeEditorialImageUrl?: string | null;
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
  seoTitle: string | null;
  seoDescription: string | null;
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
  seoTitle: string | null;
  seoDescription: string | null;
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

export const VIDEO_CATEGORIES = [
  "interview",
  "webinar",
  "demo",
  "talk",
  "clip",
  "other",
] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const VIDEO_STATUSES = ["draft", "published", "archived"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface VideoDto {
  id: string;
  slug: string;
  title: string;
  category: VideoCategory;
  videoUrl: string;
  thumbnailUrl: string | null;
  heroImage: string;
  heroImageAlt: string | null;
  shortDescription: string;
  bodyHtml: string;
  tags: string[];
  pillar: string | null;
  recordedAt: string | null;
  durationSeconds: number | null;
  status: VideoStatus;
  publishedAt: string | null;
  unpublishedAt: string | null;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoInput {
  slug?: string | null;
  title: string;
  category?: VideoCategory;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  heroImage?: string;
  heroImageAlt?: string | null;
  shortDescription?: string;
  bodyHtml?: string;
  tags?: string[];
  pillar?: string | null;
  recordedAt?: string | null;
  durationSeconds?: number | null;
  status?: VideoStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  active?: boolean;
  sourceId?: string | null;
}

export interface VideoListQuery {
  category?: VideoCategory;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface VideoListResult {
  total: number;
  page: number;
  pageSize: number;
  items: VideoDto[];
}

export const WHITE_PAPER_DOC_TYPES = ["whitepaper", "ebook", "report", "guide"] as const;
export type WhitePaperDocType = (typeof WHITE_PAPER_DOC_TYPES)[number];

export const WHITE_PAPER_STATUSES = ["draft", "published", "archived"] as const;
export type WhitePaperStatus = (typeof WHITE_PAPER_STATUSES)[number];

export interface WhitePaperDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  docType: WhitePaperDocType;
  heroImage: string;
  heroImageAlt: string | null;
  shortDescription: string;
  bodyHtml: string;
  tags: string[];
  pillar: string | null;
  documentUrl: string | null;
  externalUrl: string | null;
  pageCount: number | null;
  status: WhitePaperStatus;
  publishedAt: string | null;
  unpublishedAt: string | null;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhitePaperInput {
  slug?: string | null;
  title: string;
  subtitle?: string | null;
  docType?: WhitePaperDocType;
  heroImage?: string;
  heroImageAlt?: string | null;
  shortDescription?: string;
  bodyHtml?: string;
  tags?: string[];
  pillar?: string | null;
  documentUrl?: string | null;
  externalUrl?: string | null;
  pageCount?: number | null;
  status?: WhitePaperStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  active?: boolean;
  sourceId?: string | null;
}

export interface WhitePaperListQuery {
  docType?: WhitePaperDocType;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface WhitePaperListResult {
  total: number;
  page: number;
  pageSize: number;
  items: WhitePaperDto[];
}

export type ServiceWithSolutions = ServiceDto & { solutions: SolutionDto[] };
export type ServiceWithMethodologies = ServiceDto & { methodologies: MethodologyDto[] };
export type SolutionWithCapabilities = SolutionDto & {
  parentService: ServiceDto | null;
  capabilities: CapabilityDto[];
};

export interface UpdateSiteSettingsBody {
  requireCookieConsent: boolean;
  homeHeroImageAssetId?: number | null;
  homeEditorialImageAssetId?: number | null;
}


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
  syncEventToCollateral: (id: number) =>
    jsonFetch<{ ok: boolean }>(url(`/admin/events/${id}/sync-to-collateral`), {
      method: "POST",
    }),
  listAssets: (search?: string, category?: string) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    const q = params.toString();
    return jsonFetch<Asset[]>(url(`/assets${q ? `?${q}` : ""}`));
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
  resendSubmissionWebhook: (id: number) =>
    jsonFetch<AdminFormSubmission>(url(`/admin/forms/submissions/${id}/resend-webhook`), {
      method: "POST",
    }),
  getPublicSiteSettings: () => jsonFetch<PublicSiteSettings>(url("/site-settings")),
  getAdminSiteSettings: () => jsonFetch<AdminSiteSettings>(url("/admin/site-settings")),
  updateAdminSiteSettings: (body: UpdateSiteSettingsBody) =>
    jsonFetch<AdminSiteSettings>(url("/admin/site-settings"), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  publicTeamMembers: () => jsonFetch<PublicTeamMember[]>(url("/team-members")),
  adminTeamMembers: () => jsonFetch<AdminTeamMember[]>(url("/admin/team-members")),
  getTeamMember: (id: number) =>
    jsonFetch<AdminTeamMember>(url(`/admin/team-members/${id}`)),
  createTeamMember: (body: TeamMemberInput) =>
    jsonFetch<AdminTeamMember>(url("/admin/team-members"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTeamMember: (id: number, body: TeamMemberInput) =>
    jsonFetch<AdminTeamMember>(url(`/admin/team-members/${id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTeamMember: (id: number) =>
    jsonFetch<void>(url(`/admin/team-members/${id}`), { method: "DELETE" }),
  retrySubmission: (id: number) =>
    jsonFetch<AdminFormSubmission>(url(`/admin/forms/submissions/${id}/retry`), {
      method: "POST",
    }),
  retryFailedSubmissions: (q: Pick<SubmissionsQuery, "formType" | "search"> = {}) =>
    jsonFetch<RetryFailedSubmissionsResult>(
      url(`/admin/forms/submissions/retry-failed${submissionsQueryString(q)}`),
      { method: "POST" },
    ),
  reorderFeaturedCollateral: (ids: string[]) =>
    jsonFetch<{ updated: number }>(url("/cms/collateral/reorder"), {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  listVideos: (q: VideoListQuery = {}) => {
    const params = new URLSearchParams();
    if (q.category) params.set("category", q.category);
    if (q.tag) params.set("tag", q.tag);
    if (q.q) params.set("q", q.q);
    if (q.page) params.set("page", String(q.page));
    if (q.pageSize) params.set("pageSize", String(q.pageSize));
    const s = params.toString();
    return jsonFetch<VideoListResult>(url(`/videos${s ? `?${s}` : ""}`));
  },
  getVideo: (slug: string) =>
    jsonFetch<VideoDto>(url(`/videos/${encodeURIComponent(slug)}`)),
  adminListVideos: () => jsonFetch<{ items: VideoDto[] }>(url("/cms/videos")),
  adminGetVideo: (id: string) =>
    jsonFetch<VideoDto>(url(`/cms/videos/${encodeURIComponent(id)}`)),
  createVideo: (body: VideoInput) =>
    jsonFetch<VideoDto>(url("/cms/videos"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVideo: (id: string, body: VideoInput) =>
    jsonFetch<VideoDto>(url(`/cms/videos/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVideo: (id: string) =>
    jsonFetch<void>(url(`/cms/videos/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  syncVideoToCollateral: (id: string) =>
    jsonFetch<{ ok: boolean }>(
      url(`/cms/videos/${encodeURIComponent(id)}/sync-to-collateral`),
      { method: "POST" },
    ),
  listWhitePapers: (q: WhitePaperListQuery = {}) => {
    const params = new URLSearchParams();
    if (q.docType) params.set("docType", q.docType);
    if (q.tag) params.set("tag", q.tag);
    if (q.q) params.set("q", q.q);
    if (q.page) params.set("page", String(q.page));
    if (q.pageSize) params.set("pageSize", String(q.pageSize));
    const s = params.toString();
    return jsonFetch<WhitePaperListResult>(url(`/white-papers${s ? `?${s}` : ""}`));
  },
  getWhitePaper: (slug: string) =>
    jsonFetch<WhitePaperDto>(url(`/white-papers/${encodeURIComponent(slug)}`)),
  adminListWhitePapers: () =>
    jsonFetch<{ items: WhitePaperDto[] }>(url("/cms/white-papers")),
  adminGetWhitePaper: (id: string) =>
    jsonFetch<WhitePaperDto>(url(`/cms/white-papers/${encodeURIComponent(id)}`)),
  createWhitePaper: (body: WhitePaperInput) =>
    jsonFetch<WhitePaperDto>(url("/cms/white-papers"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateWhitePaper: (id: string, body: WhitePaperInput) =>
    jsonFetch<WhitePaperDto>(url(`/cms/white-papers/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteWhitePaper: (id: string) =>
    jsonFetch<void>(url(`/cms/white-papers/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  syncWhitePaperToCollateral: (id: string) =>
    jsonFetch<{ ok: boolean }>(
      url(`/cms/white-papers/${encodeURIComponent(id)}/sync-to-collateral`),
      { method: "POST" },
    ),
  // Polaris podcast episodes (#101).
  adminListPolarisEpisodes: () =>
    jsonFetch<{ items: PolarisEpisodeDto[] }>(url("/cms/polaris/episodes")),
  adminGetPolarisEpisode: (id: string) =>
    jsonFetch<PolarisEpisodeDto>(url(`/cms/polaris/episodes/${encodeURIComponent(id)}`)),
  createPolarisEpisode: (body: PolarisEpisodeInput) =>
    jsonFetch<PolarisEpisodeDto>(url("/cms/polaris/episodes"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePolarisEpisode: (id: string, body: PolarisEpisodeInput) =>
    jsonFetch<PolarisEpisodeDto>(url(`/cms/polaris/episodes/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePolarisEpisode: (id: string) =>
    jsonFetch<void>(url(`/cms/polaris/episodes/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  // Workshops — scoped filters (#105 removed the static category-to-service
  // lookup map; the "related workshops" rail on /services/:slug and
  // /solutions/:slug now queries by real foreign key).
  listWorkshopsByService: (serviceId: string) =>
    jsonFetch<{ items: WorkshopListItemDto[] }>(
      url(`/workshops?serviceId=${encodeURIComponent(serviceId)}`),
    ),
  listWorkshopsBySolution: (solutionId: string) =>
    jsonFetch<{ items: WorkshopListItemDto[] }>(
      url(`/workshops?solutionId=${encodeURIComponent(solutionId)}`),
    ),
  // Case studies (#102).
  listCaseStudies: (q: CaseStudyListQuery = {}) => {
    const params = new URLSearchParams();
    if (q.industry) params.set("industry", q.industry);
    if (q.tag) params.set("tag", q.tag);
    if (q.serviceId) params.set("serviceId", q.serviceId);
    if (q.solutionId) params.set("solutionId", q.solutionId);
    const s = params.toString();
    return jsonFetch<{ items: CaseStudyDto[] }>(
      url(`/case-studies${s ? `?${s}` : ""}`),
    );
  },
  getCaseStudy: (slug: string) =>
    jsonFetch<CaseStudyDto>(url(`/case-studies/${encodeURIComponent(slug)}`)),
  adminListCaseStudies: () =>
    jsonFetch<{ items: CaseStudyDto[] }>(url("/cms/case-studies")),
  adminGetCaseStudy: (id: string) =>
    jsonFetch<CaseStudyDto>(url(`/cms/case-studies/${encodeURIComponent(id)}`)),
  createCaseStudy: (body: CaseStudyInput) =>
    jsonFetch<CaseStudyDto>(url("/cms/case-studies"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCaseStudy: (id: string, body: CaseStudyPatchInput) =>
    jsonFetch<CaseStudyDto>(url(`/cms/case-studies/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteCaseStudy: (id: string) =>
    jsonFetch<void>(url(`/cms/case-studies/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  // Applications (#103).
  listApplications: (navOnly?: boolean) =>
    jsonFetch<{ items: ApplicationDto[] }>(
      url(navOnly ? "/applications?nav=true" : "/applications"),
    ),
  getApplication: (slug: string) =>
    jsonFetch<ApplicationDto>(url(`/applications/${encodeURIComponent(slug)}`)),
  adminListApplications: () =>
    jsonFetch<{ items: ApplicationDto[] }>(url("/cms/applications")),
  adminGetApplication: (id: string) =>
    jsonFetch<ApplicationDto>(url(`/cms/applications/${encodeURIComponent(id)}`)),
  createApplication: (body: ApplicationInput) =>
    jsonFetch<ApplicationDto>(url("/cms/applications"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateApplication: (id: string, body: ApplicationPatchInput) =>
    jsonFetch<ApplicationDto>(url(`/cms/applications/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteApplication: (id: string) =>
    jsonFetch<void>(url(`/cms/applications/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  // About / testimonials / partners (#104).
  listAboutValues: () =>
    jsonFetch<{ items: AboutValueDto[] }>(url("/about/values")),
  listTestimonials: () =>
    jsonFetch<{ items: ClientTestimonialDto[] }>(url("/testimonials")),
  listPartners: (category?: string) =>
    jsonFetch<{ items: PartnerDescriptionDto[] }>(
      url(category ? `/partners?category=${encodeURIComponent(category)}` : "/partners"),
    ),
  adminListAboutValues: () =>
    jsonFetch<{ items: AboutValueDto[] }>(url("/cms/about/values")),
  adminListTestimonials: () =>
    jsonFetch<{ items: ClientTestimonialDto[] }>(url("/cms/testimonials")),
  adminListPartners: () =>
    jsonFetch<{ items: PartnerDescriptionDto[] }>(url("/cms/partners")),
};

export type ArtifactStatus = "draft" | "scheduled" | "published" | "archived";

export interface PolarisEpisodeDto {
  id: string;
  slug: string;
  title: string;
  episodeNumber: number;
  summary: string;
  guestName: string | null;
  audioUrl: string;
  appleUrl: string | null;
  spotifyUrl: string | null;
  durationSeconds: number | null;
  transcriptHtml: string | null;
  artworkUrl: string;
  status: ArtifactStatus;
  publishedAt: string | null;
  unpublishedAt: string | null;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkshopListItemDto {
  id: string;
  slug: string;
  title: string;
  category: string;
  shortDescription: string;
  heroImage: string;
  duration: string;
  deliveryFormat: string;
  serviceId: string | null;
  solutionId: string | null;
  active: boolean;
}

export interface CaseStudyMetricDto {
  label: string;
  value: string;
}

export interface CaseStudySectionDto {
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface CaseStudyDto {
  id: string;
  slug: string;
  title: string;
  client: string;
  clientLabel: string;
  industry: string;
  established: string | null;
  tag: string;
  headline: string;
  summary: string;
  heroImage: string;
  clientLogo: string | null;
  challenge: CaseStudySectionDto;
  approach: CaseStudySectionDto[];
  outcome: CaseStudySectionDto;
  metrics: CaseStudyMetricDto[];
  quote: { text: string; attribution: string };
  serviceId: string | null;
  solutionId: string | null;
  status: ArtifactStatus;
  publishedAt: string | null;
  unpublishedAt: string | null;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseStudyInput {
  slug?: string | null;
  title: string;
  client?: string;
  clientLabel?: string;
  industry?: string;
  established?: string | null;
  tag?: string;
  headline?: string;
  summary?: string;
  heroImage?: string;
  clientLogo?: string | null;
  challenge?: CaseStudySectionDto;
  approach?: CaseStudySectionDto[];
  outcome?: CaseStudySectionDto;
  metrics?: CaseStudyMetricDto[];
  quote?: { text: string; attribution: string };
  serviceId?: string | null;
  solutionId?: string | null;
  status?: ArtifactStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  active?: boolean;
  sourceId?: string | null;
}

export type CaseStudyPatchInput = Partial<CaseStudyInput>;

export interface CaseStudyListQuery {
  industry?: string;
  tag?: string;
  serviceId?: string;
  solutionId?: string;
}

export interface ApplicationDto {
  id: string;
  slug: string;
  title: string;
  name: string;
  tagline: string;
  shortSummary: string;
  description: string[];
  version: string | null;
  releaseDate: string | null;
  websiteUrl: string;
  logo: string;
  screenshot: string;
  userGuideUrl: string | null;
  showInNav: boolean;
  status: ArtifactStatus;
  publishedAt: string | null;
  unpublishedAt: string | null;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationInput {
  slug?: string | null;
  title: string;
  name?: string;
  tagline?: string;
  shortSummary?: string;
  description?: string[];
  version?: string | null;
  releaseDate?: string | null;
  websiteUrl?: string;
  logo?: string;
  screenshot?: string;
  userGuideUrl?: string | null;
  showInNav?: boolean;
  status?: ArtifactStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  active?: boolean;
  sourceId?: string | null;
}

export type ApplicationPatchInput = Partial<ApplicationInput>;

export interface AboutValueDto {
  id: string;
  slug: string;
  title: string;
  body: string;
  icon: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientTestimonialDto {
  id: string;
  slug: string;
  quote: string;
  authorName: string;
  authorRole: string | null;
  organization: string;
  caseStudySlug: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerDescriptionDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  websiteUrl: string | null;
  category: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolarisEpisodeInput {
  slug?: string | null;
  title: string;
  episodeNumber: number;
  summary?: string;
  guestName?: string | null;
  audioUrl?: string;
  appleUrl?: string | null;
  spotifyUrl?: string | null;
  durationSeconds?: number | null;
  transcriptHtml?: string | null;
  artworkUrl?: string;
  status?: ArtifactStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImage?: string | null;
  active?: boolean;
  sourceId?: string | null;
}
