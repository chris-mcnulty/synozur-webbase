/**
 * #228 — Typed fetch helpers for the multi-property traffic registry admin
 * surfaces. Mirrors the manual-fetch style used by `lib/traffic-api.ts`.
 */

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${BASE_PATH}/api${path}`;
}

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface TrafficProperty {
  id: string;
  slug: string;
  name: string;
  baseUrl: string | null;
  apiKeyPrefix: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  lastIngestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficPropertyImport {
  id: string;
  propertyId: string;
  kind: string;
  sourceFile: string | null;
  sourceFileSha256: string | null;
  accepted: number;
  skipped: number;
  duplicates: number;
  errors: number;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string | null;
  createdByDisplayName: string | null;
}

export interface ImportResult {
  importId: string;
  accepted: number;
  skipped: number;
  duplicates: number;
  errors: number;
  errorSamples: Array<{ index: number; reason: string }>;
  rowsParsed: number;
}

export const trafficPropertiesApi = {
  list: () =>
    jsonFetch<{ items: TrafficProperty[] }>("/cms/traffic/properties"),
  create: (body: {
    slug: string;
    name: string;
    baseUrl?: string | null;
    notes?: string | null;
    generateApiKey?: boolean;
  }) =>
    jsonFetch<TrafficProperty & { apiKey: string | null }>(
      "/cms/traffic/properties",
      { method: "POST", body: JSON.stringify(body) },
    ),
  patch: (
    id: string,
    body: {
      name?: string;
      baseUrl?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
  ) =>
    jsonFetch<TrafficProperty>(`/cms/traffic/properties/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  rotateKey: (id: string) =>
    jsonFetch<{ apiKey: string; apiKeyPrefix: string }>(
      `/cms/traffic/properties/${id}/rotate-key`,
      { method: "POST" },
    ),
  imports: (id: string) =>
    jsonFetch<{ items: TrafficPropertyImport[] }>(
      `/cms/traffic/properties/${id}/imports`,
    ),
  importJson: (body: {
    propertySlug: string;
    rows: Array<Record<string, unknown>>;
    fileName?: string;
  }) =>
    jsonFetch<ImportResult>("/cms/traffic/import", {
      method: "POST",
      body: JSON.stringify({ ...body, kind: "json" }),
    }),
  importCsv: (body: { propertySlug: string; csv: string; fileName?: string }) =>
    jsonFetch<ImportResult>("/cms/traffic/import", {
      method: "POST",
      body: JSON.stringify({ ...body, kind: "csv" }),
    }),
};
