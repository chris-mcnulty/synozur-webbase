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
  PublicTeamMemberDetail,
  AdminTeamMember,
  TeamMemberInput,
  RetryFailedSubmissionsResult,
} from "@workspace/api-zod/types";
import { attributionPayload, type AttributionPayload } from "./attribution";

// #131: enrich any form submission body with first-touch attribution + the
// caller-supplied marketing opt-in flag. Server schemas accept these as
// optional fields.
type FormBodyExtension = AttributionPayload & { marketingOptIn?: boolean };

function withAttribution<T extends object>(
  body: T,
  extras: { marketingOptIn?: boolean } = {},
): T & FormBodyExtension {
  const attr = attributionPayload();
  return { ...body, ...attr, ...extras };
}

// #131 — Body shape for the generic /forms/:formType intake. All
// type-specific tokens are optional; callers populate whichever apply
// (e.g. `slug` + `title` for white papers; `startsAt` for webinars).
export interface GenericFormInput {
  email: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  slug?: string | null;
  startsAt?: string | null;
  application?: string | null;
  depth?: string | null;
  partnerType?: string | null;
  website?: string;
  turnstileToken: string | null;
}

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
  details: Record<string, string[]> | null;
  constructor(
    message: string,
    status: number,
    code: string | null,
    details: Record<string, string[]> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
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
    const rawDetails =
      obj && "details" in obj && obj["details"] && typeof obj["details"] === "object"
        ? (obj["details"] as Record<string, unknown>)
        : null;
    const fieldErrors =
      rawDetails && "fieldErrors" in rawDetails
        ? (rawDetails["fieldErrors"] as Record<string, string[]>)
        : null;
    throw new ApiError(`${res.status} ${detail}`, res.status, code, fieldErrors);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AdminMe {
  userId: string;
  email: string;
  authorized: boolean;
}

export interface AdminSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  rememberMe: boolean;
  isCurrent: boolean;
}

export type BookingsRenderMode = "iframe" | "native";

export type HomeRootVariant = "a" | "b";

export interface PublicSiteSettings {
  requireCookieConsent: boolean;
  homeHeroBackgroundType?: "image" | "video";
  siteTheme?: "cosmic" | "aurora" | null;
  homeRootVariant?: HomeRootVariant;
  bookingsRenderMode?: BookingsRenderMode | null;
  // #133 — Server-controlled kill-switch for the Constellation interactive
  // demo on /applications/constellation. Default true.
  constellationDemoEnabled?: boolean;
  homeHeroImageUrl?: string | null;
  homeHeroVideoUrl?: string | null;
  homeEditorialImageUrl?: string | null;
  // /home-b hero overrides — null means "inherit from the homeHero* fields".
  homeBHeroBackgroundType?: "image" | "video" | null;
  homeBHeroImageUrl?: string | null;
  homeBHeroVideoUrl?: string | null;
  seoDefaultTitleTemplate?: string | null;
  seoDefaultDescription?: string | null;
  seoDefaultOgImageUrl?: string | null;
  seoTwitterHandle?: string | null;
  seoTwitterCardType?: string | null;
  seoGoogleSiteVerification?: string | null;
  seoBingSiteVerification?: string | null;
  tagGa4Id?: string | null;
  tagLinkedinPartnerId?: string | null;
  tagMetaPixelId?: string | null;
  orgName?: string | null;
  orgLegalName?: string | null;
  orgLogoUrl?: string | null;
  orgStreetAddress?: string | null;
  orgAddressLocality?: string | null;
  orgAddressRegion?: string | null;
  orgPostalCode?: string | null;
  orgAddressCountry?: string | null;
  orgSameAs?: string[] | null;
  // #269: LocalBusiness office contact fields surfaced publicly so the
  // /contact JSON-LD blob can render admin-edited values.
  orgTelephone?: string | null;
  orgGeoLatitude?: number | null;
  orgGeoLongitude?: number | null;
  orgOpeningHours?: { days: string[]; opens: string; closes: string }[] | null;
  // #215: Alt home page (`/home-b`) editorial copy overrides.
  homeBHeroHeadlinePrefix?: string | null;
  homeBHeroHeadlineAccent?: string | null;
  homeBHeroHeadlineSuffix?: string | null;
  homeBHeroSubheadline?: string | null;
  homeBPillarsEyebrow?: string | null;
  homeBPillarsHeadline?: string | null;
  homeBPillar1Headline?: string | null;
  homeBPillar1Body?: string | null;
  homeBPillar2Headline?: string | null;
  homeBPillar2Body?: string | null;
  homeBPillar3Headline?: string | null;
  homeBPillar3Body?: string | null;
  homeBPillar4Headline?: string | null;
  homeBPillar4Body?: string | null;
  homeBClosingEyebrow?: string | null;
  homeBClosingHeadline?: string | null;
  homeBClosingBody?: string | null;
}

export interface AdminSiteSettings {
  requireCookieConsent: boolean;
  homeHeroBackgroundType?: "image" | "video";
  siteTheme?: "cosmic" | "aurora" | null;
  homeRootVariant?: HomeRootVariant;
  bookingsRenderMode?: BookingsRenderMode | null;
  // #133 — see PublicSiteSettings.
  constellationDemoEnabled?: boolean;
  homeHeroImageAssetId?: number | null;
  homeHeroImageMediaId?: string | null;
  homeHeroImageUrl?: string | null;
  homeHeroVideoAssetId?: number | null;
  homeHeroVideoMediaId?: string | null;
  homeHeroVideoUrl?: string | null;
  homeEditorialImageAssetId?: number | null;
  homeEditorialImageMediaId?: string | null;
  homeEditorialImageUrl?: string | null;
  homeBHeroBackgroundType?: "image" | "video" | null;
  homeBHeroImageMediaId?: string | null;
  homeBHeroImageUrl?: string | null;
  homeBHeroVideoMediaId?: string | null;
  homeBHeroVideoUrl?: string | null;
  idleTimeoutMs?: number | null;
  polarisFeedUrl?: string | null;
  seoDefaultTitleTemplate?: string | null;
  seoDefaultDescription?: string | null;
  seoDefaultOgImageAssetId?: number | null;
  seoDefaultOgImageMediaId?: string | null;
  seoDefaultOgImageUrl?: string | null;
  seoTwitterHandle?: string | null;
  seoTwitterCardType?: string | null;
  seoLinkedinCompanyUrl?: string | null;
  seoGoogleSiteVerification?: string | null;
  seoBingSiteVerification?: string | null;
  orgName?: string | null;
  orgLegalName?: string | null;
  orgLogoAssetId?: number | null;
  orgLogoMediaId?: string | null;
  orgLogoUrl?: string | null;
  orgStreetAddress?: string | null;
  orgAddressLocality?: string | null;
  orgAddressRegion?: string | null;
  orgPostalCode?: string | null;
  orgAddressCountry?: string | null;
  orgSameAs?: string[] | null;
  // #269
  orgTelephone?: string | null;
  orgGeoLatitude?: number | null;
  orgGeoLongitude?: number | null;
  orgOpeningHours?: { days: string[]; opens: string; closes: string }[] | null;
  tagGa4Id?: string | null;
  tagLinkedinPartnerId?: string | null;
  tagMetaPixelId?: string | null;
  sitemapExcludedPaths?: string[] | null;
  sitemapSectionFlags?: Record<string, boolean> | null;
  spamLinkThreshold?: number | null;
  spamKeywords?: string[] | null;
  spamDomainBlocklist?: string[] | null;
  auditLogRetentionDays?: number;
  // #215: Alt home page (`/home-b`) editorial copy overrides.
  homeBHeroHeadlinePrefix?: string | null;
  homeBHeroHeadlineAccent?: string | null;
  homeBHeroHeadlineSuffix?: string | null;
  homeBHeroSubheadline?: string | null;
  homeBPillarsEyebrow?: string | null;
  homeBPillarsHeadline?: string | null;
  homeBPillar1Headline?: string | null;
  homeBPillar1Body?: string | null;
  homeBPillar2Headline?: string | null;
  homeBPillar2Body?: string | null;
  homeBPillar3Headline?: string | null;
  homeBPillar3Body?: string | null;
  homeBPillar4Headline?: string | null;
  homeBPillar4Body?: string | null;
  homeBClosingEyebrow?: string | null;
  homeBClosingHeadline?: string | null;
  homeBClosingBody?: string | null;
  updatedAt: string;
}

export interface LinkedBookingDto {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
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
  bookingId: string | null;
  booking?: LinkedBookingDto | null;
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
  acceleratorsHtml: string | null;
  faqHtml: string | null;
  bookingId: string | null;
  booking?: LinkedBookingDto | null;
  active: boolean;
  // Task #317 — market-facing taxonomy that replaces `pillar` on solutions.
  // `solutionGroup` is what the marketing site partitions the menu/footer
  // by; `showInMenu` is the per-solution toggle the admin uses to curate
  // the public Solutions navigation.
  solutionGroup?:
    | "ai_strategy"
    | "gtm"
    | "company_os"
    | "consulting_services";
  showInMenu?: boolean;
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

// #61: shared shape for service / solution / methodology / capability
// revision list entries. The id fields are mutually exclusive — only the
// one matching the entity kind will be set on a given response.
export interface ServiceRevisionSummary {
  id: string;
  serviceId?: string;
  solutionId?: string;
  methodologyId?: string;
  capabilityId?: string;
  editedAt: string;
  editor: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  snapshotTitle: string | null;
  snapshotStatus: string | null;
}

// #66/#67: full snapshot returned by the per-revision detail endpoint so
// editors can preview a past version and diff it against the live draft.
export interface PostRevisionDetail {
  id: string;
  postId: string;
  editedAt: string;
  editor: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  snapshotTitle: string | null;
  snapshotSubtitle: string | null;
  snapshotExcerpt: string | null;
  snapshotBodyHtml: string | null;
  snapshotBodyMarkdown: string | null;
  snapshotSlug: string | null;
  snapshotSeoTitle: string | null;
  snapshotSeoDescription: string | null;
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

export interface WhitePaperDocumentAsset {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

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
  documentAssetId: number | null;
  documentMediaId: string | null;
  documentAsset: WhitePaperDocumentAsset | null;
  serviceId: string | null;
  solutionId: string | null;
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
  documentAssetId?: number | null;
  documentMediaId?: string | null;
  serviceId?: string | null;
  solutionId?: string | null;
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
// Task #317 — Per-solution rotating highlights. Joined with collateral
// server-side so the public renderer has everything it needs to draw a
// card without a second round-trip.
export interface SolutionHighlightDto {
  id: string;
  solutionId: string;
  collateralId: string;
  displayOrder: number;
  active: boolean;
  collateralType: string;
  collateralSlug: string;
  collateralTitle: string;
  collateralSubtitle: string | null;
  collateralDescription: string | null;
  collateralHeroImage: string | null;
  collateralUrl: string | null;
  collateralExternal: boolean;
  collateralDownloadUrl: string | null;
  collateralVideoUrl: string | null;
}

// Task #318 — Auto-listed related resources on each solution page.
// Joined server-side from `collateral_solutions` against `collateral`
// so the public renderer can feed each row straight into the existing
// CollateralCard component without a second round-trip.
export interface LinkedCollateralDto {
  collateralId: string;
  displayOrder: number;
  active: boolean;
  collateralType: string;
  collateralSlug: string;
  collateralTitle: string;
  collateralSubtitle: string | null;
  collateralDescription: string | null;
  collateralHeroImage: string | null;
  collateralPillar: string | null;
  collateralTags: string[];
  collateralUrl: string | null;
  collateralExternal: boolean;
  collateralDownloadUrl: string | null;
  collateralVideoUrl: string | null;
  collateralPublishedAt: string | null;
  collateralFeatured: boolean;
}

export type SolutionWithCapabilities = SolutionDto & {
  parentService: ServiceDto | null;
  capabilities: CapabilityDto[];
  highlights: SolutionHighlightDto[];
  linkedCollateral: LinkedCollateralDto[];
};

export interface UpdateSiteSettingsBody {
  requireCookieConsent: boolean;
  homeHeroBackgroundType?: "image" | "video";
  siteTheme?: "cosmic" | "aurora" | null;
  homeRootVariant?: HomeRootVariant;
  bookingsRenderMode?: BookingsRenderMode;
  homeHeroImageAssetId?: number | null;
  homeHeroImageMediaId?: string | null;
  homeHeroVideoAssetId?: number | null;
  homeHeroVideoMediaId?: string | null;
  homeEditorialImageAssetId?: number | null;
  homeEditorialImageMediaId?: string | null;
  homeBHeroBackgroundType?: "image" | "video" | null;
  homeBHeroImageMediaId?: string | null;
  homeBHeroVideoMediaId?: string | null;
  polarisFeedUrl?: string | null;
  seoDefaultTitleTemplate?: string | null;
  seoDefaultDescription?: string | null;
  seoDefaultOgImageAssetId?: number | null;
  seoDefaultOgImageMediaId?: string | null;
  seoTwitterHandle?: string | null;
  seoTwitterCardType?: string | null;
  seoLinkedinCompanyUrl?: string | null;
  seoGoogleSiteVerification?: string | null;
  seoBingSiteVerification?: string | null;
  orgName?: string | null;
  orgLegalName?: string | null;
  orgLogoAssetId?: number | null;
  orgLogoMediaId?: string | null;
  orgStreetAddress?: string | null;
  orgAddressLocality?: string | null;
  orgAddressRegion?: string | null;
  orgPostalCode?: string | null;
  orgAddressCountry?: string | null;
  orgSameAs?: string[] | null;
  // #269
  orgTelephone?: string | null;
  orgGeoLatitude?: number | null;
  orgGeoLongitude?: number | null;
  orgOpeningHours?: { days: string[]; opens: string; closes: string }[] | null;
  tagGa4Id?: string | null;
  tagLinkedinPartnerId?: string | null;
  tagMetaPixelId?: string | null;
  sitemapExcludedPaths?: string[] | null;
  sitemapSectionFlags?: Record<string, boolean> | null;
  idleTimeoutMs?: number | null;
  spamLinkThreshold?: number | null;
  spamKeywords?: string[] | null;
  spamDomainBlocklist?: string[] | null;
  auditLogRetentionDays?: number;
  // #215: Alt home page (`/home-b`) editorial copy overrides.
  homeBHeroHeadlinePrefix?: string | null;
  homeBHeroHeadlineAccent?: string | null;
  homeBHeroHeadlineSuffix?: string | null;
  homeBHeroSubheadline?: string | null;
  homeBPillarsEyebrow?: string | null;
  homeBPillarsHeadline?: string | null;
  homeBPillar1Headline?: string | null;
  homeBPillar1Body?: string | null;
  homeBPillar2Headline?: string | null;
  homeBPillar2Body?: string | null;
  homeBPillar3Headline?: string | null;
  homeBPillar3Body?: string | null;
  homeBPillar4Headline?: string | null;
  homeBPillar4Body?: string | null;
  homeBClosingEyebrow?: string | null;
  homeBClosingHeadline?: string | null;
  homeBClosingBody?: string | null;
  constellationDemoEnabled?: boolean;
}

export interface BulkCollateralBody {
  ids: string[];
  set?: {
    serviceId?: string | null;
    solutionId?: string | null;
    pillar?: "strategic" | "technology" | "experiences" | "gtm" | null;
    type?:
      | "webinar"
      | "white_paper"
      | "case_study"
      | "podcast"
      | "model"
      | "training"
      | "event"
      | "insight"
      | "video"
      | "ebook";
    active?: boolean;
    featured?: boolean;
  };
  tagsAction?: {
    mode: "add" | "remove" | "replace";
    tags: string[];
  };
}

// ─── SEO audit & submission types ─────────────────────────────────────────────

export type SeoArtifactKind =
  | "insight"
  | "service"
  | "solution"
  | "application"
  | "case-study"
  | "model"
  | "workshop";

export interface SeoAuditFinding {
  kind: SeoArtifactKind;
  id: string;
  slug: string;
  title: string;
  path: string;
  missing: string[];
  suggested: {
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
  };
}

export interface SeoAuditReport {
  generatedAt: string;
  totals: Record<SeoArtifactKind, { total: number; missing: number }>;
  findings: SeoAuditFinding[];
}

export interface SeoAutofillResult {
  touched: Record<SeoArtifactKind, number>;
}

export interface SeoSubmitResult {
  target: "indexnow" | "google-indexing" | "bing-webmaster";
  ok: boolean;
  status?: number;
  submitted: number;
  error?: string;
}

export interface SeoSubmitBundle {
  origin: string;
  urls: string[];
  results: SeoSubmitResult[];
}

// #160 — Search Console / Bing index-coverage dashboard.
export interface SeoCoverageKindBuckets {
  kind: string;
  total: number;
  indexed: number;
  discoveredNotIndexed: number;
  crawlError: number;
  soft404: number;
  unknown: number;
}

export interface SeoCoverageRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  urlCount: number;
  googleConfigured: boolean;
  bingConfigured: boolean;
  googleChecked: number;
  bingChecked: number;
  error: string | null;
}

export interface SeoCoverageOverview {
  lastRun: SeoCoverageRun | null;
  googleConfigured: boolean;
  bingConfigured: boolean;
  byKind: SeoCoverageKindBuckets[];
  scanRunning: boolean;
}

export interface SeoCoverageUrlRow {
  url: string;
  path: string;
  artifactKind: string;
  googleBucket: string | null;
  googleCoverageState: string | null;
  bingBucket: string | null;
  bingHttpStatus: number | null;
  lastCheckedAt: string | null;
}


export const api = {
  listServices: () => jsonFetch<{ items: ServiceWithSolutions[] }>(url("/services")),
  // Task #317 — public list of solutions, used by the marketing header
  // and footer to render the post-Board taxonomy directly from the CMS.
  // No filter by default — returns every published+active solution.
  // Pass `showInMenu: true` to restrict to nav-visible rows (used by the
  // header/footer + featured-trio query). Callers that want the full set
  // (e.g. the Consulting grid on Services Overview) just omit the option.
  listSolutions: (opts: { showInMenu?: boolean } = {}) => {
    const qs =
      opts.showInMenu === true
        ? "?showInMenu=true"
        : opts.showInMenu === false
          ? "?showInMenu=false"
          : "";
    return jsonFetch<{ items: SolutionDto[] }>(url(`/solutions${qs}`));
  },
  listServicesAdmin: () =>
    jsonFetch<{ items: ServiceWithSolutions[] }>(url("/cms/services-with-solutions")),
  getService: (slug: string, previewToken?: string | null) =>
    jsonFetch<ServiceWithMethodologies>(
      url(
        `/services/${encodeURIComponent(slug)}${
          previewToken ? `?preview=${encodeURIComponent(previewToken)}` : ""
        }`,
      ),
    ),
  getSolution: (slug: string, previewToken?: string | null) =>
    jsonFetch<SolutionWithCapabilities>(
      url(
        `/solutions/${encodeURIComponent(slug)}${
          previewToken ? `?preview=${encodeURIComponent(previewToken)}` : ""
        }`,
      ),
    ),
  // #60: admin-only — mint a 24 h signed token for the public detail page.
  createServicePreviewToken: (id: string) =>
    jsonFetch<{ token: string; expiresAt: string; slug: string; previewPath: string }>(
      url(`/cms/services/${encodeURIComponent(id)}/preview-token`),
      { method: "POST" },
    ),
  createSolutionPreviewToken: (id: string) =>
    jsonFetch<{ token: string; expiresAt: string; slug: string; previewPath: string }>(
      url(`/cms/solutions/${encodeURIComponent(id)}/preview-token`),
      { method: "POST" },
    ),
  // #61: revision history for services and solutions.
  listServiceRevisions: (id: string) =>
    jsonFetch<{ items: ServiceRevisionSummary[] }>(
      url(`/cms/services/${encodeURIComponent(id)}/revisions`),
    ),
  restoreServiceRevision: (id: string, revisionId: string) =>
    jsonFetch<ServiceDto>(
      url(
        `/cms/services/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
      { method: "POST" },
    ),
  listSolutionRevisions: (id: string) =>
    jsonFetch<{ items: ServiceRevisionSummary[] }>(
      url(`/cms/solutions/${encodeURIComponent(id)}/revisions`),
    ),
  // #66/#67: full snapshot for a single post revision.
  getCmsPostRevision: (postId: string, revisionId: string) =>
    jsonFetch<PostRevisionDetail>(
      url(
        `/cms/posts/${encodeURIComponent(postId)}/revisions/${encodeURIComponent(revisionId)}`,
      ),
    ),
  // Task #317 — rotating highlights admin helpers.
  listSolutionHighlights: (id: string) =>
    jsonFetch<{ items: SolutionHighlightDto[] }>(
      url(`/cms/solutions/${encodeURIComponent(id)}/highlights`),
    ),
  replaceSolutionHighlights: (
    id: string,
    items: { collateralId: string; displayOrder?: number; active?: boolean }[],
  ) =>
    jsonFetch<{ items: SolutionHighlightDto[] }>(
      url(`/cms/solutions/${encodeURIComponent(id)}/highlights`),
      { method: "PUT", body: JSON.stringify({ items }) },
    ),
  // Task #318 — Collateral × Solutions join admin helpers. Each typed
  // library editor (white paper, video, workshop, polaris episode) needs
  // its mirrored `collateral.id` to manage solution links; the generic
  // collateral editor just passes its own id straight through.
  lookupCollateralBySource: (sourceId: string) =>
    jsonFetch<{ collateralId: string }>(
      url(`/cms/collateral/by-source/${encodeURIComponent(sourceId)}`),
    ),
  listCollateralSolutions: (collateralId: string) =>
    jsonFetch<{
      items: {
        solutionId: string;
        displayOrder: number;
        active: boolean;
        solutionTitle: string;
        solutionSlug: string;
        parentServiceId: string | null;
        parentServiceTitle: string | null;
      }[];
    }>(url(`/cms/collateral/${encodeURIComponent(collateralId)}/solutions`)),
  replaceCollateralSolutions: (
    collateralId: string,
    items: { solutionId: string; displayOrder?: number; active?: boolean }[],
  ) =>
    jsonFetch<{
      items: {
        solutionId: string;
        displayOrder: number;
        active: boolean;
        solutionTitle: string;
        solutionSlug: string;
        parentServiceId: string | null;
        parentServiceTitle: string | null;
      }[];
    }>(url(`/cms/collateral/${encodeURIComponent(collateralId)}/solutions`), {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  restoreSolutionRevision: (id: string, revisionId: string) =>
    jsonFetch<SolutionDto>(
      url(
        `/cms/solutions/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
      { method: "POST" },
    ),
  // #61: revision history for individual methodology and capability blocks.
  listMethodologyRevisions: (id: string) =>
    jsonFetch<{ items: ServiceRevisionSummary[] }>(
      url(`/cms/methodologies/${encodeURIComponent(id)}/revisions`),
    ),
  restoreMethodologyRevision: (id: string, revisionId: string) =>
    jsonFetch<MethodologyDto>(
      url(
        `/cms/methodologies/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
      { method: "POST" },
    ),
  listCapabilityRevisions: (id: string) =>
    jsonFetch<{ items: ServiceRevisionSummary[] }>(
      url(`/cms/capabilities/${encodeURIComponent(id)}/revisions`),
    ),
  restoreCapabilityRevision: (id: string, revisionId: string) =>
    jsonFetch<CapabilityDto>(
      url(
        `/cms/capabilities/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
      { method: "POST" },
    ),
  publicEvents: () => jsonFetch<PublicEvent[]>(url("/events")),
  publicEvent: (slug: string) => jsonFetch<PublicEvent>(url(`/events/${slug}`)),
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
  submitContact: (body: ContactFormInput, opts: { marketingOptIn?: boolean } = {}) =>
    jsonFetch<FormSubmissionAck>(url("/forms/contact"), {
      method: "POST",
      body: JSON.stringify(withAttribution(body, opts)),
    }),
  submitSubscribe: (body: SubscribeFormInput, opts: { marketingOptIn?: boolean } = {}) =>
    jsonFetch<FormSubmissionAck>(url("/forms/subscribe"), {
      method: "POST",
      body: JSON.stringify(withAttribution(body, opts)),
    }),
  submitStart: (body: StartFormInput, opts: { marketingOptIn?: boolean } = {}) =>
    jsonFetch<FormSubmissionAck>(url("/forms/start"), {
      method: "POST",
      body: JSON.stringify(withAttribution(body, opts)),
    }),
  // #131 — Generic intake for white-paper / webinar / partner / demo
  // capture forms. The server route lives at POST /forms/:formType and
  // routes through the same persist + HubSpot enqueue path as the named
  // endpoints above. `body` carries the type-specific context fields
  // (slug/title/startsAt/application/depth/partnerType) which become
  // timeline-event tokens in HubSpot.
  submitGenericForm: (
    formType: "white-paper" | "webinar" | "partner" | "demo",
    body: GenericFormInput,
    opts: { marketingOptIn?: boolean } = {},
  ) =>
    jsonFetch<FormSubmissionAck>(url(`/forms/${formType}`), {
      method: "POST",
      body: JSON.stringify(withAttribution(body, opts)),
    }),
  listSubmissions: (q: SubmissionsQuery = {}) =>
    jsonFetch<AdminFormSubmissionsPage>(url(`/admin/forms/submissions${submissionsQueryString(q)}`)),
  submissionsCsvUrl: (q: Pick<SubmissionsQuery, "formType" | "search"> = {}) =>
    url(`/admin/forms/submissions.csv${submissionsQueryString(q)}`),
  resendSubmissionWebhook: (id: number) =>
    jsonFetch<AdminFormSubmission>(url(`/admin/forms/submissions/${id}/resend-webhook`), {
      method: "POST",
    }),
  listSessions: () => jsonFetch<AdminSession[]>(url("/auth/sessions")),
  revokeSession: (id: string) =>
    jsonFetch<{ ok: boolean }>(url(`/auth/sessions/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  getPublicSiteSettings: () => jsonFetch<PublicSiteSettings>(url("/site-settings")),
  // A/B experiments — public read for the visitor runtime.
  getActiveExperiments: () =>
    jsonFetch<import("@workspace/api-zod/types").GetActiveExperimentsResponse>(
      url("/experiments/active"),
    ),
  postExperimentAssignment: (
    body: import("@workspace/api-zod/types").PostAssignmentBody,
  ) =>
    jsonFetch<{ ok: boolean }>(url("/experiments/assignments"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Admin CRUD for experiments.
  listAdminExperiments: () =>
    jsonFetch<import("@workspace/api-zod/types").ListAdminExperimentsResponse>(
      url("/admin/experiments"),
    ),
  getAdminExperiment: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}`),
    ),
  createAdminExperiment: (body: import("@workspace/api-zod/types").CreateExperimentBody) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url("/admin/experiments"),
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateAdminExperiment: (
    id: string,
    body: import("@workspace/api-zod/types").UpdateExperimentBody,
  ) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  startAdminExperiment: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}/start`),
      { method: "POST" },
    ),
  pauseAdminExperiment: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}/pause`),
      { method: "POST" },
    ),
  endAdminExperiment: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}/end`),
      { method: "POST" },
    ),
  duplicateAdminExperiment: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperiment>(
      url(`/admin/experiments/${encodeURIComponent(id)}/duplicate`),
      { method: "POST" },
    ),
  deleteAdminExperiment: (id: string) =>
    jsonFetch<void>(url(`/admin/experiments/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  createAdminVariant: (
    experimentId: string,
    body: import("@workspace/api-zod/types").CreateVariantBody,
  ) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperimentVariant>(
      url(`/admin/experiments/${encodeURIComponent(experimentId)}/variants`),
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateAdminVariant: (
    variantId: string,
    body: import("@workspace/api-zod/types").UpdateVariantBody,
  ) =>
    jsonFetch<import("@workspace/api-zod/types").AdminExperimentVariant>(
      url(`/admin/variants/${encodeURIComponent(variantId)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteAdminVariant: (variantId: string) =>
    jsonFetch<void>(url(`/admin/variants/${encodeURIComponent(variantId)}`), {
      method: "DELETE",
    }),
  getAdminExperimentResults: (id: string) =>
    jsonFetch<import("@workspace/api-zod/types").GetExperimentResultsResponse>(
      url(`/admin/experiments/${encodeURIComponent(id)}/results`),
    ),
  getAdminSiteSettings: () => jsonFetch<AdminSiteSettings>(url("/admin/site-settings")),
  updateAdminSiteSettings: (body: UpdateSiteSettingsBody) =>
    jsonFetch<AdminSiteSettings>(url("/admin/site-settings"), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  seoAudit: () => jsonFetch<SeoAuditReport>(url("/seo/audit")),
  seoAuditAutofill: (ids?: Array<{ kind: SeoArtifactKind; id: string }>) =>
    jsonFetch<SeoAutofillResult>(url("/seo/audit/autofill"), {
      method: "POST",
      body: JSON.stringify(ids && ids.length > 0 ? { ids } : {}),
    }),
  seoSubmit: (urls: string[]) =>
    jsonFetch<SeoSubmitBundle>(url("/seo/submit"), {
      method: "POST",
      body: JSON.stringify({ urls }),
    }),
  seoCoverage: () =>
    jsonFetch<SeoCoverageOverview>(url("/cms/seo-coverage")),
  seoCoverageUrls: (params: { kind?: string; bucket?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.kind) q.set("kind", params.kind);
    if (params.bucket) q.set("bucket", params.bucket);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return jsonFetch<{ rows: SeoCoverageUrlRow[] }>(
      url(`/cms/seo-coverage/urls${qs ? `?${qs}` : ""}`),
    );
  },
  seoCoverageScan: () =>
    jsonFetch<{ started: boolean; alreadyRunning?: boolean }>(
      url("/cms/seo-coverage/scan"),
      { method: "POST", body: JSON.stringify({}) },
    ),
  publicTeamMembers: () => jsonFetch<PublicTeamMember[]>(url("/team-members")),
  publicTeamMember: (slug: string) =>
    jsonFetch<PublicTeamMemberDetail>(url(`/team-members/${encodeURIComponent(slug)}`)),
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
  bulkUpdateCollateral: (body: BulkCollateralBody) =>
    jsonFetch<{ updated: number }>(url("/cms/collateral/bulk"), {
      method: "POST",
      body: JSON.stringify(body),
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
  getPolarisCollateralLink: (id: string) =>
    jsonFetch<{ collateral: PolarisCollateralLinkDto | null }>(
      url(`/cms/polaris/episodes/${encodeURIComponent(id)}/collateral`),
    ),
  syncPolarisToCollateral: (id: string) =>
    jsonFetch<{ collateral: PolarisCollateralLinkDto }>(
      url(`/cms/polaris/episodes/${encodeURIComponent(id)}/sync-collateral`),
      { method: "POST" },
    ),
  bulkSyncPolarisToCollateral: () =>
    jsonFetch<{ total: number; created: number; updated: number }>(
      url("/cms/polaris/episodes/bulk-sync-collateral"),
      { method: "POST" },
    ),
  removePolarisCollateralLink: (id: string) =>
    jsonFetch<void>(
      url(`/cms/polaris/episodes/${encodeURIComponent(id)}/sync-collateral`),
      { method: "DELETE" },
    ),
  // Picker for linking a Polaris episode to a related blog post. Returns
  // posts categorized as "Polaris" or "podcast" (slug or name match).
  listPolarisLinkablePosts: (q?: string) => {
    const qs = q && q.trim().length > 0 ? `?q=${encodeURIComponent(q.trim())}` : "";
    return jsonFetch<{ items: PolarisLinkablePostDto[] }>(
      url(`/cms/polaris/episodes/post-picker${qs}`),
    );
  },
  previewPolarisLibsyn: (feedUrl?: string) => {
    const qs = feedUrl ? `?feedUrl=${encodeURIComponent(feedUrl)}` : "";
    return jsonFetch<{ feedUrl: string; items: PolarisLibsynPreviewItem[] }>(
      url(`/cms/polaris/libsyn/preview${qs}`),
    );
  },
  importPolarisLibsyn: (body: PolarisLibsynImportInput) =>
    jsonFetch<PolarisLibsynImportSummary>(url("/cms/polaris/libsyn/import"), {
      method: "POST",
      body: JSON.stringify(body),
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
  // Models (#106).
  listModels: (pillar?: CollateralPillar) => {
    const s = pillar ? `?pillar=${encodeURIComponent(pillar)}` : "";
    return jsonFetch<{ items: ModelDto[] }>(url(`/models${s}`));
  },
  getModel: (slug: string) =>
    jsonFetch<ModelDto>(url(`/models/${encodeURIComponent(slug)}`)),
  adminListModels: () =>
    jsonFetch<{ items: ModelDto[] }>(url("/cms/models")),
  adminGetModel: (id: string) =>
    jsonFetch<ModelDto>(url(`/cms/models/${encodeURIComponent(id)}`)),
  createModel: (body: ModelInput) =>
    jsonFetch<ModelDto>(url("/cms/models"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateModel: (id: string, body: ModelPatchInput) =>
    jsonFetch<ModelDto>(url(`/cms/models/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteModel: (id: string) =>
    jsonFetch<void>(url(`/cms/models/${encodeURIComponent(id)}`), {
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
  // FAQ (#107).
  listFaq: () =>
    jsonFetch<{ categories: FaqCategoryWithItemsDto[] }>(url("/faq")),
  adminListFaqCategories: () =>
    jsonFetch<{ items: FaqCategoryDto[] }>(url("/cms/faq/categories")),
  adminCreateFaqCategory: (body: FaqCategoryInput) =>
    jsonFetch<FaqCategoryDto>(url("/cms/faq/categories"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateFaqCategory: (id: string, body: FaqCategoryPatchInput) =>
    jsonFetch<FaqCategoryDto>(url(`/cms/faq/categories/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeleteFaqCategory: (id: string) =>
    jsonFetch<void>(url(`/cms/faq/categories/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  adminReorderFaqCategories: (ids: string[]) =>
    jsonFetch<void>(url("/cms/faq/categories/reorder"), {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  adminListFaqItems: (categoryId?: string) =>
    jsonFetch<{ items: FaqItemDto[] }>(
      url(
        categoryId
          ? `/cms/faq/items?categoryId=${encodeURIComponent(categoryId)}`
          : "/cms/faq/items",
      ),
    ),
  adminCreateFaqItem: (body: FaqItemInput) =>
    jsonFetch<FaqItemDto>(url("/cms/faq/items"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adminUpdateFaqItem: (id: string, body: FaqItemPatchInput) =>
    jsonFetch<FaqItemDto>(url(`/cms/faq/items/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminDeleteFaqItem: (id: string) =>
    jsonFetch<void>(url(`/cms/faq/items/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  adminReorderFaqItems: (categoryId: string, ids: string[]) =>
    jsonFetch<void>(url("/cms/faq/items/reorder"), {
      method: "POST",
      body: JSON.stringify({ categoryId, ids }),
    }),
  // Parent-page copy (#97).
  getParentPage: (slug: string) =>
    jsonFetch<ContentParentPageDto>(
      url(`/content-parent-pages/${encodeURIComponent(slug)}`),
    ),
  adminListParentPages: () =>
    jsonFetch<{ items: ContentParentPageDto[] }>(url("/cms/content-parent-pages")),
  adminUpdateParentPage: (id: string, body: ContentParentPagePatchInput) =>
    jsonFetch<ContentParentPageDto>(
      url(`/cms/content-parent-pages/${encodeURIComponent(id)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  // Bookings — Microsoft Bookings embeds shown on /start.
  listBookings: () =>
    jsonFetch<{ items: BookingDto[] }>(url("/bookings")),
  getBooking: (slug: string) =>
    jsonFetch<BookingDto>(url(`/bookings/${encodeURIComponent(slug)}`)),
  adminListBookings: () =>
    jsonFetch<{ items: BookingDto[] }>(url("/admin/bookings")),
  adminGetBooking: (id: string) =>
    jsonFetch<BookingDto>(url(`/admin/bookings/${encodeURIComponent(id)}`)),
  createBooking: (body: BookingInput) =>
    jsonFetch<BookingDto>(url("/admin/bookings"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateBooking: (id: string, body: BookingPatchInput) =>
    jsonFetch<BookingDto>(url(`/admin/bookings/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteBooking: (id: string) =>
    jsonFetch<void>(url(`/admin/bookings/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  // Graph service-account connection (delegated auth for native Bookings flow).
  bookingsGraphStatus: () =>
    jsonFetch<{ connected: boolean; account: string | null; entraConfigured: boolean }>(
      url("/admin/bookings/graph-status"),
    ),
  bookingsGraphDisconnect: () =>
    jsonFetch<void>(url("/admin/bookings/graph-token"), { method: "DELETE" }),
  // bookingsGraphAuthorizeHref — not a fetch; callers use this as window.location.href
  // to start the full-page Microsoft OAuth flow.
  bookingsGraphAuthorizeHref: (): string => url("/admin/bookings/graph-authorize"),
  // Native (Microsoft Graph) booking flow. Only meaningful when the site
  // setting `bookingsRenderMode` is "native" and the booking row has an
  // msBusinessId — otherwise these endpoints respond 404/409.
  listNativeBookingServices: (slug: string) =>
    jsonFetch<NativeBookingServicesResponse>(
      url(`/bookings/${encodeURIComponent(slug)}/services`),
    ),
  listNativeBookingAvailability: (
    slug: string,
    args: { serviceId: string; startUtc: string; endUtc: string },
  ) => {
    const qs = new URLSearchParams({
      serviceId: args.serviceId,
      start: args.startUtc,
      end: args.endUtc,
    });
    return jsonFetch<{ slots: NativeBookingSlot[] }>(
      url(`/bookings/${encodeURIComponent(slug)}/availability?${qs.toString()}`),
    );
  },
  createNativeBookingAppointment: (slug: string, body: NativeBookingAppointmentInput) =>
    jsonFetch<{ ok: true }>(url(`/bookings/${encodeURIComponent(slug)}/appointments`), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // AI grounding documents — Vega-pattern grounding store. Admin-only; gated
  // by the ai.grounding.manage capability on the server.
  listGroundingDocuments: () =>
    jsonFetch<{ items: GroundingDocumentDto[] }>(url("/ai/grounding-documents")),
  createGroundingDocument: (body: GroundingDocumentInput) =>
    jsonFetch<GroundingDocumentDto>(url("/ai/grounding-documents"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGroundingDocument: (id: string, body: Partial<GroundingDocumentInput>) =>
    jsonFetch<GroundingDocumentDto>(
      url(`/ai/grounding-documents/${encodeURIComponent(id)}`),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteGroundingDocument: (id: string) =>
    jsonFetch<void>(
      url(`/ai/grounding-documents/${encodeURIComponent(id)}`),
      { method: "DELETE" },
    ),
  parseGroundingPdf: async (file: File) => {
    const buffer = await file.arrayBuffer();
    return jsonFetch<{ markdown: string }>(url("/ai/parse-pdf"), {
      method: "POST",
      body: buffer,
      headers: { "Content-Type": "application/octet-stream" },
    });
  },
  parseGroundingDocx: async (file: File) => {
    const buffer = await file.arrayBuffer();
    return jsonFetch<{ markdown: string }>(url("/ai/parse-docx"), {
      method: "POST",
      body: buffer,
      headers: { "Content-Type": "application/octet-stream" },
    });
  },
};

export const GROUNDING_CATEGORIES = [
  "methodology",
  "best_practices",
  "terminology",
  "examples",
  "about_synozur",
  "brand_voice",
  "audience_personas",
  "concierge_persona",
] as const;
export type GroundingCategory = (typeof GROUNDING_CATEGORIES)[number];

export interface GroundingDocumentDto {
  id: string;
  title: string;
  description: string | null;
  category: GroundingCategory;
  content: string;
  scopeTags: string[];
  priority: number;
  isActive: boolean;
  conciergeEligible: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroundingDocumentInput {
  title: string;
  description?: string | null;
  category: GroundingCategory;
  content: string;
  scopeTags?: string[] | null;
  priority?: number;
  isActive?: boolean;
  conciergeEligible?: boolean;
}

export type ArtifactStatus = "draft" | "scheduled" | "published" | "archived";

export interface PolarisLibsynPreviewItem {
  guid: string;
  title: string;
  episodeNumber: number | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  audioUrl: string;
  artworkUrl: string | null;
  summary: string;
  link: string | null;
  existsInDb: boolean;
  existingId: string | null;
  existingEpisodeNumber: number | null;
}

export interface PolarisLibsynImportInput {
  guids: string[];
  allowResync?: boolean;
  feedUrl?: string;
}

export interface PolarisLibsynImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ guid: string; message: string }>;
}

export interface PolarisCollateralLinkDto {
  id: string;
  slug: string;
  title: string;
  featured: boolean;
  featuredRank: number | null;
  active: boolean;
  publishedAt: string | null;
  updatedAt: string;
  // Tags currently set on the collateral row. May drift from the episode's
  // own tags if the episode was edited but never re-synced.
  serviceId: string | null;
  solutionId: string | null;
}

export interface PolarisLinkedPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  heroImageUrl: string | null;
  publishedAt: string | null;
  bodyHtml: string | null;
  // Only present on CMS responses (admin endpoints). Public episode
  // responses are filtered to published posts and omit this field.
  status?: ArtifactStatus;
}

export interface PolarisLinkablePostDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  status: ArtifactStatus;
}

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
  serviceId: string | null;
  solutionId: string | null;
  linkedPostId: string | null;
  linkedPost: PolarisLinkedPostDto | null;
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
  atAGlance: string | null;
  whatWeDid: string | null;
  whyItWorked: string | null;
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
  atAGlance?: string | null;
  whatWeDid?: string | null;
  whyItWorked?: string | null;
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
  serviceId: string | null;
  solutionId: string | null;
  bookingId: string | null;
  booking?: LinkedBookingDto | null;
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
  serviceId?: string | null;
  solutionId?: string | null;
  bookingId?: string | null;
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

// Models (#106).
export type CollateralPillar = "strategic" | "technology" | "experiences" | "gtm";

export interface ModelRelatedItemDto {
  label: string;
  url: string;
  kind?: "link" | "white-paper" | "video" | "case-study";
}

export interface ModelDto {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  heroImage: string;
  longDescriptionHtml: string;
  dimensionsHtml: string;
  launchUrl: string;
  relatedInformation: ModelRelatedItemDto[];
  pillar: CollateralPillar | null;
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

export interface ModelInput {
  slug?: string | null;
  title: string;
  shortDescription?: string;
  heroImage?: string;
  longDescriptionHtml?: string;
  dimensionsHtml?: string;
  launchUrl?: string;
  relatedInformation?: ModelRelatedItemDto[];
  pillar?: CollateralPillar | null;
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

export type ModelPatchInput = Partial<ModelInput>;

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

// FAQ (#107, #108). #108 brought the schema onto the shared artifact pattern,
// so `status` is now the four-state ArtifactStatus enum and the admin
// endpoints surface the full lifecycle (publish window, featured, active).
// `FaqStatus` is now an alias for `ArtifactStatus` — the admin UI's
// draft↔published toggle only writes the two original values, but the
// type intentionally permits the full enum so anything that already
// holds a `'scheduled'` or `'archived'` row (e.g. via the API) keeps
// type-checking. Future UI work can lean on the wider type without
// another migration.
export type FaqStatus = ArtifactStatus;

export interface FaqCategoryDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  displayOrder: number;
  status: ArtifactStatus;
  createdAt: string;
  updatedAt: string;
  // #108 admin-only lifecycle fields. Optional so the public /api/faq
  // payload (which doesn't include them) still type-checks as a valid
  // FaqCategoryDto on the client.
  title?: string;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  active?: boolean;
  sourceId?: string | null;
  deletedAt?: string | null;
}

export interface FaqItemDto {
  id: string;
  categoryId: string;
  slug: string;
  question: string;
  answerHtml: string;
  displayOrder: number;
  status: ArtifactStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
  // #108 admin-only lifecycle fields (see FaqCategoryDto).
  title?: string;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  active?: boolean;
  sourceId?: string | null;
  deletedAt?: string | null;
}

export interface FaqCategoryWithItemsDto extends FaqCategoryDto {
  items: FaqItemDto[];
}

export interface FaqCategoryInput {
  slug?: string | null;
  name: string;
  description?: string | null;
  displayOrder?: number;
  status?: ArtifactStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  active?: boolean;
}
export type FaqCategoryPatchInput = Partial<FaqCategoryInput>;

export interface FaqItemInput {
  categoryId: string;
  slug?: string | null;
  question: string;
  answerHtml?: string;
  displayOrder?: number;
  status?: ArtifactStatus;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  featured?: boolean;
  featuredRank?: number | null;
  active?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}
export type FaqItemPatchInput = Partial<FaqItemInput>;

// Parent-page copy (#97).
export interface ContentParentPageDto {
  id: string;
  slug: string;
  heroEyebrow: string | null;
  heroHeadline: string | null;
  heroSubhead: string | null;
  introHtml: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ContentParentPagePatchInput = Partial<
  Omit<ContentParentPageDto, "id" | "slug" | "createdAt" | "updatedAt">
>;

// Bookings — Microsoft Bookings embed entries surfaced on /start.
export const BOOKING_SCOPES = ["general", "offer", "conference"] as const;
export type BookingScope = (typeof BOOKING_SCOPES)[number];

export interface BookingDto {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  descriptionHtml: string | null;
  embedUrl: string;
  scope: BookingScope | string;
  startsAt: string | null;
  endsAt: string | null;
  displayOrder: number;
  active: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  msBusinessId: string | null;
  msDefaultServiceId: string | null;
  msTimezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingInput {
  slug?: string | null;
  title: string;
  teaser?: string | null;
  descriptionHtml?: string | null;
  embedUrl: string;
  scope?: BookingScope;
  startsAt?: string | null;
  endsAt?: string | null;
  displayOrder?: number;
  active?: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
  msBusinessId?: string | null;
  msDefaultServiceId?: string | null;
  msTimezone?: string | null;
}

export type BookingPatchInput = Partial<BookingInput>;

// Native (Microsoft Graph) booking flow.
export interface NativeBookingService {
  id: string;
  displayName: string;
  description: string | null;
  defaultDurationMinutes: number | null;
  defaultPriceType: string | null;
  defaultPrice: number | null;
}

export interface NativeBookingServicesResponse {
  business: { displayName: string; defaultTimeZone: string | null };
  defaultServiceId: string | null;
  services: NativeBookingService[];
}

export interface NativeBookingSlot {
  startUtc: string;
  endUtc: string;
}

export interface NativeBookingAppointmentInput {
  serviceId: string;
  startUtc: string;
  endUtc: string;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    notes?: string | null;
  };
  customerTimeZone: string;
  turnstileToken: string | null;
  website?: string;
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
  serviceId?: string | null;
  solutionId?: string | null;
  linkedPostId?: string | null;
}
