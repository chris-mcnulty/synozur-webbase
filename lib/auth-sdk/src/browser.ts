// Browser OIDC client. Designed for SPAs that need to redirect users to the
// Synozur OAuth provider, redeem the resulting code, refresh tokens, and
// call /oauth/userinfo.
//
// Storage: tokens + the in-flight PKCE verifier are stored in
// `sessionStorage` (cleared when the tab closes) by default. Callers that
// want longer persistence can pass a custom `Storage` implementation.

import { generatePkcePair, randomUrlSafeString } from "./pkce";
import type { TokenResponse, UserInfo } from "./types";

export interface BrowserOidcClientConfig {
  // The OAuth provider's origin (e.g. https://synozur.com). Must NOT include
  // a trailing slash.
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  // Optional: defaults to sessionStorage. Pass `localStorage` to survive
  // tab close, or an in-memory shim for tests.
  storage?: Storage;
  // Optional: prefix for storage keys. Defaults to `synozur-oauth`.
  storageKeyPrefix?: string;
}

interface PendingState {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo?: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number; // ms epoch
  scope: string;
}

export class BrowserOidcClient {
  private readonly cfg: Required<
    Omit<BrowserOidcClientConfig, "storage" | "storageKeyPrefix">
  > & {
    storage: Storage;
    storageKeyPrefix: string;
  };

  constructor(config: BrowserOidcClientConfig) {
    this.cfg = {
      ...config,
      storage:
        config.storage ??
        (typeof window !== "undefined" ? window.sessionStorage : (undefined as unknown as Storage)),
      storageKeyPrefix: config.storageKeyPrefix ?? "synozur-oauth",
    };
  }

  private key(suffix: string): string {
    return `${this.cfg.storageKeyPrefix}:${suffix}`;
  }

  /**
   * Build the /oauth/authorize URL and persist the PKCE verifier + state so
   * the callback handler can redeem the code. Caller is responsible for
   * navigating the browser to the returned URL.
   */
  async buildAuthorizeUrl(opts: { returnTo?: string } = {}): Promise<string> {
    const { codeVerifier, codeChallenge, codeChallengeMethod } =
      await generatePkcePair();
    const state = randomUrlSafeString(16);
    const pending: PendingState = {
      state,
      codeVerifier,
      redirectUri: this.cfg.redirectUri,
    };
    if (opts.returnTo) pending.returnTo = opts.returnTo;
    this.cfg.storage.setItem(this.key("pending"), JSON.stringify(pending));

    const url = new URL(`${this.cfg.issuer}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.cfg.clientId);
    url.searchParams.set("redirect_uri", this.cfg.redirectUri);
    url.searchParams.set("scope", this.cfg.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", codeChallengeMethod);
    return url.toString();
  }

  /**
   * Redeem the code returned to the redirect URI. Validates `state` against
   * the value stored at authorize time. On success, persists the tokens and
   * returns the redeemed token set + the pre-redirect `returnTo` if any.
   */
  async handleCallback(params: URLSearchParams): Promise<{
    tokens: StoredTokens;
    returnTo?: string;
  }> {
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    if (error) {
      throw new Error(
        `OAuth error: ${error}${
          params.get("error_description") ? ` — ${params.get("error_description")}` : ""
        }`,
      );
    }
    if (!code || !state) throw new Error("Missing code or state in callback");

    const raw = this.cfg.storage.getItem(this.key("pending"));
    if (!raw) throw new Error("No pending OAuth flow found");
    const pending = JSON.parse(raw) as PendingState;
    if (pending.state !== state) throw new Error("OAuth state mismatch");
    this.cfg.storage.removeItem(this.key("pending"));

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: this.cfg.clientId,
      code_verifier: pending.codeVerifier,
    });
    const res = await fetch(`${this.cfg.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as TokenResponse;
    const tokens = this.persistTokens(json);
    const result: { tokens: StoredTokens; returnTo?: string } = { tokens };
    if (pending.returnTo) result.returnTo = pending.returnTo;
    return result;
  }

  private persistTokens(t: TokenResponse): StoredTokens {
    const stored: StoredTokens = {
      accessToken: t.access_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      scope: t.scope ?? this.cfg.scope,
    };
    if (t.refresh_token) stored.refreshToken = t.refresh_token;
    if (t.id_token) stored.idToken = t.id_token;
    this.cfg.storage.setItem(this.key("tokens"), JSON.stringify(stored));
    return stored;
  }

  getStoredTokens(): StoredTokens | null {
    const raw = this.cfg.storage.getItem(this.key("tokens"));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  }

  clearTokens(): void {
    this.cfg.storage.removeItem(this.key("tokens"));
    this.cfg.storage.removeItem(this.key("pending"));
  }

  /**
   * Return a non-expired access token, refreshing transparently if needed.
   * Returns null if there are no stored tokens or if refresh fails.
   * A 30-second skew avoids handing out a token that's about to expire.
   */
  async getAccessToken(): Promise<string | null> {
    const stored = this.getStoredTokens();
    if (!stored) return null;
    if (stored.expiresAt - Date.now() > 30_000) return stored.accessToken;
    if (!stored.refreshToken) return null;
    const refreshed = await this.refresh(stored.refreshToken);
    return refreshed?.accessToken ?? null;
  }

  async refresh(refreshToken: string): Promise<StoredTokens | null> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.cfg.clientId,
    });
    const res = await fetch(`${this.cfg.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      this.clearTokens();
      return null;
    }
    const json = (await res.json()) as TokenResponse;
    return this.persistTokens(json);
  }

  async fetchUserInfo(): Promise<UserInfo | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return null;
    const res = await fetch(`${this.cfg.issuer}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as UserInfo;
  }
}
