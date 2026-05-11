// Client wrapper for the DB-backed standalone landing pages
// (e.g. /ai-training). Mirrors the api-workshops / api-careers shape so
// it stays out of the giant `api.ts` object.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function url(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

export class LandingPagesApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LandingPagesApiError";
    this.status = status;
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
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const detail = obj && "error" in obj ? String(obj["error"]) : res.statusText;
    throw new LandingPagesApiError(`${res.status} ${detail}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Block payload shapes — kept in sync with lib/db/src/schema/landingPages.ts
// ---------------------------------------------------------------------------

export type LandingPageCTA = {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
};

export type HeroBlock = {
  type: "hero";
  eyebrow?: string | null;
  title: string;
  subtitle?: string | null;
  theme?: "nebula" | "light" | null;
};

export type RichTextBlock = {
  type: "richText";
  heading?: string | null;
  bodyHtml: string;
};

export type CardGridCard = {
  code?: string | null;
  title: string;
  description?: string | null;
  level?: string | null;
  url?: string | null;
  source?: string | null;
};

export type CardGridBlock = {
  type: "cardGrid";
  heading?: string | null;
  intro?: string | null;
  cards: CardGridCard[];
};

export type CtaBlock = {
  type: "cta";
  heading: string;
  body?: string | null;
  buttons: LandingPageCTA[];
  theme?: "nebula" | "light" | null;
};

export type ImageBlock = {
  type: "image";
  url: string;
  alt?: string | null;
  caption?: string | null;
};

export type FaqBlock = {
  type: "faq";
  heading?: string | null;
  items: { q: string; a: string }[];
};

export type LandingPageBlock =
  | HeroBlock
  | RichTextBlock
  | CardGridBlock
  | CtaBlock
  | ImageBlock
  | FaqBlock;

export type LandingPageStatus = "draft" | "published" | "archived";

export interface LandingPageDto {
  id: string;
  slug: string;
  title: string;
  status: LandingPageStatus;
  blocks: LandingPageBlock[];
  seoTitle: string | null;
  seoDescription: string | null;
  seoCanonicalUrl: string | null;
  ogImageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LandingPageInput {
  slug?: string | null;
  title: string;
  status?: LandingPageStatus;
  blocks?: LandingPageBlock[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoCanonicalUrl?: string | null;
  ogImageUrl?: string | null;
}

// Wire format for a single landing-page export file. `format` + `version`
// pin the schema so we can evolve later without silently mis-parsing old
// files. The page payload mirrors `LandingPageInput` minus the optional
// "leave alone" semantics — every field is explicit.
export interface LandingPageExport {
  format: "synozur-landing-page";
  version: 1;
  exportedAt?: string;
  page: {
    slug: string;
    title: string;
    status: LandingPageStatus;
    blocks: LandingPageBlock[];
    seoTitle: string | null;
    seoDescription: string | null;
    seoCanonicalUrl: string | null;
    ogImageUrl: string | null;
  };
}

export interface LandingPageImportResult {
  mode: "created" | "updated";
  page: LandingPageDto;
}

// Signalled separately from the generic LandingPagesApiError because the
// admin UI needs to surface the existing row's metadata (status, updated
// timestamp) before the operator decides whether to force the overwrite.
export class LandingPageImportConflictError extends LandingPagesApiError {
  existing: LandingPageDto;
  constructor(existing: LandingPageDto, message: string) {
    super(message, 409);
    this.name = "LandingPageImportConflictError";
    this.existing = existing;
  }
}

export const landingPagesApi = {
  getPublic: (slug: string) =>
    jsonFetch<LandingPageDto>(url(`/landing-pages/${encodeURIComponent(slug)}`)),
  listAdmin: (opts: { search?: string; status?: LandingPageStatus } = {}) => {
    const params = new URLSearchParams();
    if (opts.search) params.set("search", opts.search);
    if (opts.status) params.set("status", opts.status);
    const q = params.toString();
    return jsonFetch<{ items: LandingPageDto[] }>(
      url(`/cms/landing-pages${q ? `?${q}` : ""}`),
    );
  },
  getAdmin: (id: string) =>
    jsonFetch<LandingPageDto>(url(`/cms/landing-pages/${encodeURIComponent(id)}`)),
  create: (body: LandingPageInput) =>
    jsonFetch<LandingPageDto>(url("/cms/landing-pages"), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<LandingPageInput>) =>
    jsonFetch<LandingPageDto>(url(`/cms/landing-pages/${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    jsonFetch<void>(url(`/cms/landing-pages/${encodeURIComponent(id)}`), {
      method: "DELETE",
    }),
  // Returns the parsed JSON body (not a Blob) so callers can both download
  // it and inspect the payload. The server also sets a
  // Content-Disposition header, but we drive the download from the client
  // because that lets us share the same endpoint for "view" workflows.
  exportPage: async (id: string): Promise<LandingPageExport> => {
    const res = await fetch(url(`/cms/landing-pages/${encodeURIComponent(id)}/export`), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new LandingPagesApiError(`${res.status} ${res.statusText}`, res.status);
    }
    return (await res.json()) as LandingPageExport;
  },
  // Handled outside `jsonFetch` because the 409 path returns the existing
  // row inline, and the admin UI needs that body to render a confirm
  // dialog. Other failure modes fall through to the generic error class.
  importPage: async (
    payload: LandingPageExport,
    opts: { force?: boolean } = {},
  ): Promise<LandingPageImportResult> => {
    const res = await fetch(url("/cms/landing-pages/import"), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, force: opts.force === true }),
    });
    if (res.ok) return (await res.json()) as LandingPageImportResult;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const detail = obj && "error" in obj ? String(obj["error"]) : res.statusText;
    if (
      res.status === 409 &&
      obj &&
      "existing" in obj &&
      obj["existing"] &&
      typeof obj["existing"] === "object"
    ) {
      throw new LandingPageImportConflictError(
        obj["existing"] as LandingPageDto,
        `${res.status} ${detail}`,
      );
    }
    throw new LandingPagesApiError(`${res.status} ${detail}`, res.status);
  },
};
