import { createHash, randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger";

// Native Microsoft Entra (Azure AD) OIDC client.
//
// Replaces the previous Clerk-routed sign-in path. Implements the
// authorization-code flow with PKCE and S256 challenge against the v2.0
// endpoint, validates the returned ID token against the tenant JWKS, and
// returns the canonical claim set used by the app's session/identity layer.
//
// Configuration is env-driven so we can run without DB writes:
//   ENTRA_TENANT_ID            Synozur's own tenant GUID, OR "organizations"
//                              for a multi-tenant Azure app registration. When
//                              set to a GUID, users from that tenant are treated
//                              as Synozur internal (group reconciliation runs).
//                              When set to "organizations", tenant validation is
//                              deferred to the post-callback allowlist check in
//                              routes/auth.ts (supports client org SSO).
//   ENTRA_APP_CLIENT_ID        public-client / web app client id
//   ENTRA_APP_CLIENT_SECRET    only required when the app reg is "web" (confidential)
//   AUTH_REDIRECT_URI          optional override for the callback URL. When
//                              absent the callback URL is derived from the
//                              incoming request's host header so both dev
//                              (Replit preview domain) and prod work without
//                              separate deployments or env-var swaps.
//   AUTH_POST_LOGOUT_URI       optional, where Entra sends the browser after RP-initiated logout
//
// Group claims are NOT relied on from the ID token by default — Entra only
// emits them when the app reg requests them, and large directories truncate.
// We mirror identity here and let `entra.ts` fetch transitive groups via
// Graph after sign-in.

export interface EntraDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string | null;
  jwksUri: string;
  issuer: string;
}

export interface EntraIdTokenClaims extends JWTPayload {
  oid?: string;       // Entra object id (user-stable across email changes)
  tid?: string;       // tenant id
  preferred_username?: string;
  email?: string;
  name?: string;
  groups?: string[];
  hasgroups?: boolean;
  picture?: string;
  upn?: string;
}

interface DiscoveryCacheEntry {
  doc: EntraDiscovery;
  fetchedAt: number;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
const discoveryCache = new Map<string, DiscoveryCacheEntry>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function tenantAuthority(): string {
  return process.env["ENTRA_TENANT_ID"] ?? "";
}

function clientId(): string {
  return process.env["ENTRA_APP_CLIENT_ID"] ?? "";
}

function clientSecret(): string | null {
  const v = process.env["ENTRA_CLIENT_SECRET"] ?? process.env["ENTRA_APP_CLIENT_SECRET"];
  return v && v.length > 0 ? v : null;
}

// Returns the env-override redirect URI, or null when the caller should
// derive it dynamically from the request (see deriveCallbackUri in auth.ts).
export function redirectUriOverride(): string | null {
  const v = process.env["AUTH_REDIRECT_URI"];
  return v && v.length > 0 ? v : null;
}

export function postLogoutRedirectUri(): string | null {
  const v = process.env["AUTH_POST_LOGOUT_URI"];
  return v && v.length > 0 ? v : null;
}

export function isEntraConfigured(): boolean {
  return tenantAuthority().length > 0 && clientId().length > 0;
}

export async function fetchDiscovery(tenantHint?: string): Promise<EntraDiscovery> {
  const tid = tenantHint ?? tenantAuthority();
  if (!tid) throw new Error("ENTRA_TENANT_ID not configured");
  const cached = discoveryCache.get(tid);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    return cached.doc;
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tid)}/v2.0/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Entra discovery failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const doc: EntraDiscovery = {
    authorizationEndpoint: String(json["authorization_endpoint"] ?? ""),
    tokenEndpoint: String(json["token_endpoint"] ?? ""),
    endSessionEndpoint:
      typeof json["end_session_endpoint"] === "string" ? (json["end_session_endpoint"] as string) : null,
    jwksUri: String(json["jwks_uri"] ?? ""),
    issuer: String(json["issuer"] ?? ""),
  };
  if (!doc.authorizationEndpoint || !doc.tokenEndpoint || !doc.jwksUri || !doc.issuer) {
    throw new Error("Entra discovery document missing required fields");
  }
  discoveryCache.set(tid, { doc, fetchedAt: Date.now() });
  return doc;
}

function jwks(jwksUri: string) {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, set);
  }
  return set;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkcePair(): PkcePair {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateRandomToken(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes));
}

export interface AuthorizeUrlInput {
  state: string;
  nonce: string;
  pkceChallenge: string;
  redirectUri: string;
  scope?: string[];
  prompt?: "login" | "select_account" | "consent" | "none";
  loginHint?: string;
}

const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];

export async function buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string> {
  if (!isEntraConfigured()) {
    throw new Error("Entra OIDC is not configured (ENTRA_TENANT_ID / ENTRA_APP_CLIENT_ID)");
  }
  const disco = await fetchDiscovery();
  const scopes = (input.scope ?? DEFAULT_SCOPES).join(" ");
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: scopes,
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.pkceChallenge,
    code_challenge_method: "S256",
  });
  if (input.prompt) params.set("prompt", input.prompt);
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${disco.authorizationEndpoint}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const disco = await fetchDiscovery();
  const body = new URLSearchParams({
    client_id: clientId(),
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    scope: DEFAULT_SCOPES.join(" "),
  });
  const secret = clientSecret();
  if (secret) body.set("client_secret", secret);
  const res = await fetch(disco.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw new Error(`Entra token exchange failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (!json["id_token"] || !json["access_token"]) {
    throw new Error("Entra token response missing id_token/access_token");
  }
  return {
    accessToken: String(json["access_token"]),
    idToken: String(json["id_token"]),
    refreshToken: typeof json["refresh_token"] === "string" ? (json["refresh_token"] as string) : null,
    expiresIn: typeof json["expires_in"] === "number" ? (json["expires_in"] as number) : 3600,
    tokenType: typeof json["token_type"] === "string" ? (json["token_type"] as string) : "Bearer",
  };
}

export interface VerifiedIdToken {
  claims: EntraIdTokenClaims;
  raw: string;
}

export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<VerifiedIdToken> {
  const disco = await fetchDiscovery();
  // For multi-tenant apps the issuer in the discovery doc contains a {tenantid}
  // placeholder; jose's iss check would fail. We override by accepting any issuer
  // whose host matches login.microsoftonline.com / sts.windows.net and verify
  // the tid claim in routes/auth.ts against the configured allowlist.
  const { payload } = await jwtVerify(idToken, jwks(disco.jwksUri), {
    audience: clientId(),
    clockTolerance: 30,
  });
  const claims = payload as EntraIdTokenClaims;
  if (claims.nonce !== expectedNonce) {
    throw new Error("ID token nonce mismatch");
  }
  // Validate issuer host. Entra issuer formats:
  //   https://login.microsoftonline.com/{tenantId}/v2.0
  //   https://sts.windows.net/{tenantId}/   (legacy v1)
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  let issHost = "";
  try { issHost = new URL(iss).host; } catch { /* invalid */ }
  if (issHost !== "login.microsoftonline.com" && issHost !== "sts.windows.net") {
    throw new Error(`Unexpected ID token issuer: ${iss}`);
  }
  return { claims, raw: idToken };
}

export function buildLogoutUrl(args: { idTokenHint?: string | null; postLogoutRedirectUri?: string | null }): string | null {
  const tid = tenantAuthority();
  if (!tid) return null;
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tid)}/oauth2/v2.0/logout`,
  );
  const post = args.postLogoutRedirectUri ?? postLogoutRedirectUri();
  if (post) url.searchParams.set("post_logout_redirect_uri", post);
  if (args.idTokenHint) url.searchParams.set("id_token_hint", args.idTokenHint);
  return url.toString();
}

export interface NormalizedIdentity {
  externalSubject: string;       // OIDC `sub` — stable, opaque, per-app
  entraObjectId: string | null;  // tenant directory object id (oid)
  entraTenantId: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export function normalizeIdentity(claims: EntraIdTokenClaims): NormalizedIdentity {
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) throw new Error("ID token missing sub claim");
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : typeof claims.upn === "string"
          ? claims.upn
          : null;
  return {
    externalSubject: sub,
    entraObjectId: typeof claims.oid === "string" ? claims.oid : null,
    entraTenantId: typeof claims.tid === "string" ? claims.tid : null,
    email,
    displayName: typeof claims.name === "string" ? claims.name : null,
    avatarUrl: typeof claims.picture === "string" ? (claims.picture as string) : null,
  };
}

// Convenience: log a non-fatal warning when the runtime config looks
// inconsistent. Helpful in dev where envs drift.
export function warnIfMisconfigured(): void {
  if (!isEntraConfigured()) {
    logger.warn(
      "Entra OIDC not fully configured — SSO sign-in is disabled. Set ENTRA_TENANT_ID and ENTRA_APP_CLIENT_ID.",
    );
    return;
  }
  if (!redirectUriOverride()) {
    logger.info(
      "Entra: AUTH_REDIRECT_URI not set — callback URI will be derived dynamically from each incoming request's host. Both dev and prod work automatically this way.",
    );
  }
  if (clientSecret() === null) {
    logger.info(
      "Entra: running as a public client (no ENTRA_APP_CLIENT_SECRET). PKCE is required by Entra for public clients — already enabled.",
    );
  }
}
