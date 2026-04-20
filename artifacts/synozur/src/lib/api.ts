import type { PublicEvent, AdminEvent, Asset, EventInput, AssetInput } from "@workspace/api-zod";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function url(path: string): string {
  return `${BASE_PATH}/api${path}`;
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
    const detail = (body && typeof body === "object" && "error" in (body as Record<string, unknown>))
      ? String((body as Record<string, unknown>).error)
      : res.statusText;
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AdminMe {
  userId: string;
  email: string;
  authorized: boolean;
}

export const api = {
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
};
