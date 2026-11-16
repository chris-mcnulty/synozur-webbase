import { getOauthClient } from "@/lib/oauthClient";

export interface PrivateAsset {
  id: string;
  kind: "html" | "audio" | "transcript";
  filename: string;
  contentType: string;
  sizeBytes: number;
  state: "ready";
}

export interface PrivatePage {
  id: string;
  title: string;
  slug: string;
  status: string;
  revision: number;
  reviewedRevision: number | null;
  organizationId: string;
  assets: PrivateAsset[];
}

export class PrivateApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function isAuthError(e: unknown): boolean {
  return e instanceof PrivateApiError && (e.status === 401 || e.status === 403 || e.status === 404);
}

// Bearer goes in the Authorization header only, never a URL. Shared-org
// sessions have no OAuth token and rely on the HttpOnly cookie.
async function authedFetch(path: string): Promise<Response> {
  let token: string | null = null;
  try {
    token = await getOauthClient().getAccessToken();
  } catch {
    token = null;
  }
  const res = await fetch(path, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
    } catch { /* ignore */ }
    throw new PrivateApiError(res.status, detail || "Request failed");
  }
  return res;
}

function q(previewOrg?: string | null) {
  return previewOrg ? `?previewOrg=${encodeURIComponent(previewOrg)}` : "";
}

export async function listPrivatePages(): Promise<PrivatePage[]> {
  const r = await authedFetch("/api/private-pages");
  return ((await r.json()) as { items: PrivatePage[] }).items;
}

export async function getPrivatePage(id: string, previewOrg?: string | null): Promise<PrivatePage> {
  const r = await authedFetch(`/api/private-pages/${encodeURIComponent(id)}${q(previewOrg)}`);
  return (await r.json()) as PrivatePage;
}

export async function getPrivateHtml(id: string, previewOrg?: string | null): Promise<string> {
  const r = await authedFetch(`/api/private-pages/${encodeURIComponent(id)}/html${q(previewOrg)}`);
  return r.text();
}

export async function getPrivateAudio(id: string, previewOrg?: string | null): Promise<Blob> {
  const r = await authedFetch(`/api/private-pages/${encodeURIComponent(id)}/assets/audio${q(previewOrg)}`);
  return r.blob();
}

export async function getPrivateTranscriptFile(id: string, previewOrg?: string | null): Promise<Blob> {
  const r = await authedFetch(`/api/private-pages/${encodeURIComponent(id)}/assets/transcript${q(previewOrg)}`);
  return r.blob();
}

export async function getPrivateScript(id: string, previewOrg?: string | null): Promise<string> {
  const r = await authedFetch(`/api/private-pages/${encodeURIComponent(id)}/script${q(previewOrg)}`);
  return ((await r.json()) as { text: string }).text;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
