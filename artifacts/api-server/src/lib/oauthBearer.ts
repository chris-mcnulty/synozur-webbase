/**
 * OAuth Bearer-token verification for inbound API requests — #128.
 *
 * Lets `attachUserIfPresent` accept tokens issued by /oauth/token in addition
 * to the cookie session. Used by downstream Synozur apps (Galaxy, partner
 * portal, …) that authenticate via the OAuth provider instead of sharing the
 * `sid` cookie.
 *
 * Verification uses the locally-published JWKS (built from `oauthKeys.ts`)
 * and validates `iss` matches our origin and `typ === "access"` so an ID
 * token can't be replayed as an access token.
 */

import { createLocalJWKSet, exportJWK, importSPKI, jwtVerify, type JWK } from "jose";
import { getPublishedKeys } from "./oauthKeys";
import { siteOrigin } from "./siteOrigin";

export interface OAuthAccessClaims {
  sub: string;
  aud: string;
  scope: string;
  scopes: string[];
  capabilities: string[];
  roles: string[];
  expiresAt: number;
}

const JWKS_CACHE_TTL_MS = 60_000;
let _cache: { keys: JWK[] } | null = null;
let _expiry = 0;

async function buildJwks(): Promise<{ keys: JWK[] }> {
  const now = Date.now();
  if (_cache && now < _expiry) return _cache;
  const published = await getPublishedKeys();
  const keys: JWK[] = await Promise.all(
    published.map(async (k) => {
      const pub = await importSPKI(k.publicKeyPem, k.algorithm);
      const jwk = await exportJWK(pub);
      return { ...jwk, kid: k.kid, alg: k.algorithm, use: "sig" };
    }),
  );
  _cache = { keys };
  _expiry = now + JWKS_CACHE_TTL_MS;
  return _cache;
}

/**
 * Returns the parsed access-token claims, or `null` when the token is
 * missing, malformed, expired, signed by an unknown key, or carries the
 * wrong `typ`. Never throws — callers fall back to anonymous auth.
 */
export async function verifyOAuthAccessToken(
  token: string,
): Promise<OAuthAccessClaims | null> {
  try {
    const jwksData = await buildJwks();
    const jwks = createLocalJWKSet(jwksData);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: siteOrigin(),
    });
    if (payload["typ"] !== "access") return null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    const audClaim = payload.aud;
    const aud = typeof audClaim === "string" ? audClaim : Array.isArray(audClaim) ? audClaim[0] ?? "" : "";
    const scope = typeof payload["scope"] === "string" ? payload["scope"] : "";
    const scopes = scope.split(/\s+/).filter(Boolean);
    const capabilities = Array.isArray(payload["cap"]) ? (payload["cap"] as string[]) : [];
    const roles = Array.isArray(payload["roles"]) ? (payload["roles"] as string[]) : [];
    const expiresAt = typeof payload.exp === "number" ? payload.exp : 0;
    return { sub, aud, scope, scopes, capabilities, roles, expiresAt };
  } catch {
    return null;
  }
}
