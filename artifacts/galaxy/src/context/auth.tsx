import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getOauthClient } from "@/lib/oauthClient";

// Galaxy authenticates via the central Synozur OAuth 2.0 / OIDC provider
// (#128). On sign-in we redirect the user through /oauth/authorize with
// PKCE; the resulting access + refresh tokens are stored in localStorage
// under the `galaxy-oauth:*` namespace and presented as Bearer tokens on
// every API call. Replaces the same-host `sid` cookie bridge that earlier
// versions of Galaxy used — Galaxy is now a fully decoupled OAuth client
// that could move to a different origin without a re-architecture.

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

// Wire the api-client-react fetch helper to pull a fresh access token (with
// transparent refresh) for every API call. Must run before any query fires.
let _tokenGetterInstalled = false;
function installTokenGetter() {
  if (_tokenGetterInstalled) return;
  _tokenGetterInstalled = true;
  setAuthTokenGetter(() => getOauthClient().getAccessToken());
}

// `/api/auth/session` is no longer used; Galaxy now derives identity from
// the OAuth provider. We still hit `/api/auth/session` after a successful
// OAuth handshake to hydrate the full server-shaped `AuthedUser` (roles,
// capabilities) — the userinfo endpoint deliberately exposes only the
// identity claims (sub / email / name / picture), not authorization claims.
async function fetchMe(): Promise<AuthedUser | null> {
  try {
    const token = await getOauthClient().getAccessToken();
    if (!token) return null;
    const res = await fetch(`/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
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

  installTokenGetter();

  const refresh = useCallback(async () => {
    const fresh = await fetchMe();
    setUser(fresh);
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (returnTo?: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
    const target =
      returnTo ?? window.location.pathname + window.location.search;
    // Strip the Galaxy base path so callback can route relative to wouter.
    const stripped = target.startsWith(base + "/")
      ? target.slice(base.length)
      : target;
    const url = await getOauthClient().buildAuthorizeUrl({
      returnTo: stripped || "/",
    });
    window.location.assign(url);
  }, []);

  const signOut = useCallback(async () => {
    getOauthClient().clearTokens();
    setUser(null);
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
    window.location.assign(`${base}/`);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoaded,
      isSignedIn: !!user,
      user,
      signIn: (returnTo) => {
        void signIn(returnTo);
      },
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
