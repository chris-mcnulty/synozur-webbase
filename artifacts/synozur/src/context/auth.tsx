import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Native auth context. The SPA reads session state from `/api/auth/session`
// and triggers sign-in by redirecting to `/sign-in`, which handles both SSO
// and email/password flows.

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// #110 — seven audience classes alongside the legacy CMS roles. Kept as a
// string union here (rather than imported from @workspace/db) because the
// auth context is consumed by both admin and public routes — the latter
// doesn't otherwise pull the schema package in.
type RoleName =
  | "admin"
  | "editor"
  | "author"
  | "contributor"
  | "client"
  | "site_admin"
  | "content_author"
  | "hr"
  | "internal"
  | "customer"
  | "registered";

export interface AuthedUser {
  id: string;
  externalSubject: string | null;
  authProvider: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  roles: RoleName[];
  // #111 — server-supplied effective capabilities. Optional so old server
  // responses still type-check during a rolling deploy.
  effectiveCapabilities?: readonly string[];
}

export interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthedUser | null;
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AUTH_CHANNEL = "synozur-auth";
const AUTH_SIGNAL_KEY = "synozur-auth-signal";

/** Tell other tabs the session changed (sign-out / account switch). */
export function broadcastAuthChange() {
  try {
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.postMessage({ type: "auth-changed", at: Date.now() });
    ch.close();
  } catch {
    /* BroadcastChannel unsupported — storage event below covers it */
  }
  try {
    localStorage.setItem(AUTH_SIGNAL_KEY, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<AuthedUser | null> {
  try {
    const res = await fetch(`${BASE_PATH}/api/auth/session`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { signedIn: boolean; user?: AuthedUser };
    if (!json.signedIn) return null;
    return json.user ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const refreshVersion = useRef(0);
  const signingOut = useRef(false);

  const refresh = useCallback(async () => {
    if (signingOut.current) return;
    const version = ++refreshVersion.current;
    const fresh = await fetchMe();
    if (version !== refreshVersion.current || signingOut.current) return;
    // Keep the same object when identity/roles are unchanged so focus-driven
    // refreshes don't re-render every consumer.
    setUser((prev) =>
      prev && fresh && JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh,
    );
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-validate the session whenever the tab regains attention or is restored
  // from bfcache, and react to sign-out / account changes in other tabs, so
  // identity-keyed private UI (e.g. Board of Advisors) never outlives a session.
  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onPageShow = () => void refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_SIGNAL_KEY) {
        setUser(null);
        void refresh();
      }
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.onmessage = () => {
        setUser(null);
        void refresh();
      };
    } catch {
      channel = null;
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [refresh]);

  const signIn = useCallback((returnTo?: string) => {
    const target = returnTo ?? window.location.pathname + window.location.search;
    const url = new URL(`${BASE_PATH}/sign-in`, window.location.origin);
    url.searchParams.set("returnTo", target);
    window.location.assign(url.toString());
  }, []);

  const signOut = useCallback(async () => {
    // A slow focus/session response must never restore the previous account.
    signingOut.current = true;
    ++refreshVersion.current;
    setUser(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/sign-out`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const json = (await res.json()) as { redirect?: string };
        setUser(null);
        broadcastAuthChange();
        if (json.redirect) {
          window.location.assign(json.redirect);
          return;
        }
      }
    } catch {
      // Even if the network call fails, blow away local state.
      setUser(null);
    }
    // Always drop the identity locally so identity-keyed caches (Board) purge.
    setUser(null);
    broadcastAuthChange();
    window.location.assign(`${BASE_PATH}/`);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoaded,
      isSignedIn: !!user,
      user,
      signIn,
      signOut,
      refresh,
    }),
    [isLoaded, user, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // The provider hasn't mounted yet — return an inert "loading" shape so
    // first-render reads don't crash.
    return {
      isLoaded: false,
      isSignedIn: false,
      user: null,
      signIn: () => undefined,
      signOut: async () => undefined,
      refresh: async () => undefined,
    };
  }
  return ctx;
}
