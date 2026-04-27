import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Native auth context. Replaces Clerk's `useUser` / `useAuth` / `useClerk` —
// the SPA reads identity from `/api/auth/me` and triggers sign-in by
// redirecting to `/sign-in`, which handles both SSO and email/password flows.

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

const AuthContext = createContext<AuthState | null>(null);

async function fetchMe(): Promise<AuthedUser | null> {
  try {
    const res = await fetch(`${BASE_PATH}/api/auth/session`, {
      credentials: "include",
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

  const refresh = useCallback(async () => {
    const fresh = await fetchMe();
    setUser(fresh);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback((returnTo?: string) => {
    const target = returnTo ?? window.location.pathname + window.location.search;
    const url = new URL(`${BASE_PATH}/sign-in`, window.location.origin);
    url.searchParams.set("returnTo", target);
    window.location.assign(url.toString());
  }, []);

  const signOut = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/sign-out`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const json = (await res.json()) as { redirect?: string };
        setUser(null);
        if (json.redirect) {
          window.location.assign(json.redirect);
          return;
        }
      }
    } catch {
      // Even if the network call fails, blow away local state.
      setUser(null);
    }
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
    // first-render reads don't crash. This mirrors Clerk's pattern of
    // surfacing `isLoaded=false` while the SDK boots.
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
