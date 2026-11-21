import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetBoardStatus } from "@workspace/api-client-react";
import { useAuth, type AuthedUser } from "@/context/auth";

/** Root of every Board query key — removed wholesale on any auth change. */
export const BOARD_KEY_ROOT = "board" as const;

/** Never let the browser HTTP cache serve board payloads. */
export const BOARD_REQUEST: RequestInit = { cache: "no-store", credentials: "include" };

export const BOARD_STATUS_POLL_MS = 30_000;

export function isBoardAdmin(user: AuthedUser | null | undefined): boolean {
  const roles: readonly string[] = user?.roles ?? [];
  return roles.includes("admin") || roles.includes("site_admin");
}

export function useBoardIdentity() {
  const { isLoaded, user } = useAuth();
  const uid = user?.id ?? "anon";
  const roles = [...(user?.roles ?? [])].sort().join(",");
  return {
    isLoaded,
    uid,
    roles,
    isAdmin: isLoaded && isBoardAdmin(user),
    key: (...parts: (string | number)[]) =>
      [BOARD_KEY_ROOT, uid, roles, ...parts] as const,
  };
}

/** Polled visibility status; keyed by identity. */
export function useBoardStatus() {
  const id = useBoardIdentity();
  const q = useGetBoardStatus({
    query: {
      queryKey: id.key("status"),
      enabled: id.isLoaded,
      refetchInterval: BOARD_STATUS_POLL_MS,
      refetchOnWindowFocus: true,
      staleTime: 0,
      gcTime: 0,
    },
    request: BOARD_REQUEST,
  });
  // Fail closed: an errored status never counts as public, even if a
  // previous successful response is still cached.
  const isPublic = !q.isError && q.data?.public === true;
  return {
    ...id,
    statusQ: q,
    isPublic,
    ready: id.isLoaded && (id.isAdmin || !q.isLoading),
    canView: id.isLoaded && (isPublic || id.isAdmin),
  };
}

/** Whether nav should show the Board link. */
export function useBoardNavVisible(): boolean {
  return useBoardStatus().canView;
}

/** Mounted inside the QueryClientProvider: purges board data whenever the
 *  signed-in identity or roles change (including sign-out). */
export function BoardAuthSync() {
  const qc = useQueryClient();
  const { isLoaded, user } = useAuth();
  const sig = `${user?.id ?? "anon"}|${[...(user?.roles ?? [])].sort().join(",")}`;
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoaded) return;
    if (prev.current !== null && prev.current !== sig) {
      qc.cancelQueries({ queryKey: [BOARD_KEY_ROOT] });
      qc.removeQueries({ queryKey: [BOARD_KEY_ROOT] });
    }
    prev.current = sig;
  }, [isLoaded, sig, qc]);
  return null;
}

export function clearBoardCache(qc: ReturnType<typeof useQueryClient>) {
  qc.cancelQueries({ queryKey: [BOARD_KEY_ROOT] });
  qc.removeQueries({ queryKey: [BOARD_KEY_ROOT] });
}

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return undefined;
}

export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const t = url.trim();
  const l = t.toLowerCase();
  if (l.startsWith("http://") || l.startsWith("https://") || l.startsWith("mailto:")) return t;
  return undefined;
}

export function safeEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const t = email.trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(t) ? `mailto:${t}` : undefined;
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function errStatus(err: unknown): number | undefined {
  const e = err as { status?: number; response?: { status?: number }; message?: string } | null;
  if (!e) return undefined;
  if (typeof e.status === "number") return e.status;
  if (typeof e.response?.status === "number") return e.response.status;
  const m = /\b(401|403|404)\b/.exec(e.message ?? "");
  return m ? Number(m[1]) : undefined;
}
