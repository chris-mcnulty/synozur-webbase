import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Galaxy reuses the Synozur native auth contract: same session cookie (`sid`)
// resolves identity through the api-server's /api/auth/session endpoint, and
// sign-in is delegated to the existing /sign-in page on the Synozur surface.
// Sharing the cookie means a customer who already signed in on synozur lands
// straight onto the portal without a second auth round-trip; sign-out clears
// the cookie everywhere it's accepted.

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

// The Galaxy app is mounted at /galaxy/ and the api-server lives at /api on
// the same origin behind the shared proxy, so absolute /api/* paths work for
// both auth and portal data without a Vite proxy config.
async function fetchMe(): Promise<AuthedUser | null> {
  try {
    const res = await fetch(`/api/auth/session`, { credentials: "include" });
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
    const target =
      returnTo ?? window.location.pathname + window.location.search;
    const url = new URL(`/sign-in`, window.location.origin);
    url.searchParams.set("returnTo", target);
    window.location.assign(url.toString());
  }, []);

  const signOut = useCallback(async () => {
    try {
      const res = await fetch(`/api/auth/sign-out`, {
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
      setUser(null);
    }
    window.location.assign(`/`);
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

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
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
