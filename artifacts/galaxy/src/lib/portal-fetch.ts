import { getOauthClient } from "@/lib/oauthClient";

export async function portalFetch<T>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = new URL(`${window.location.origin}/api${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const token = await getOauthClient().getAccessToken().catch(() => null);
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(url.toString(), { credentials: "include", headers });

  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  }
  return res.json() as Promise<T>;
}
