/**
 * OAuth token helpers — #128 Phase B.
 *
 * Signs RS256 access + ID tokens using the active key from `oauthKeys.ts`,
 * and owns the scope vocabulary plus the scope → capability mapping that
 * decides what's in the `cap` claim. Refresh tokens are opaque (NOT JWTs)
 * so they can be revoked unilaterally; we hash them at rest and ship the
 * raw token only in the immediate response.
 */

import { randomBytes, createHash } from "crypto";
import { SignJWT, importPKCS8 } from "jose";
import { getActiveSigningKey } from "./oauthKeys";
import { siteOrigin } from "./siteOrigin";

// ─── Scope vocabulary ─────────────────────────────────────────────────────────
//
// Scopes are a separate vocabulary from the admin-side capabilities. A scope
// is what a downstream app *requests*; a capability is what the user *has*.
// The token's `cap` claim is the intersection — what this user can do, gated
// to what this client asked for.
//
// `roles.manage:tenant` is reserved for the per-OAuth-client roles follow-up
// (see BACKLOG.md #128 §1) and isn't grantable yet.

export const KNOWN_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "content.read",
  "content.write",
  "engagements.read",
  "deliverables.read",
  "invoices.read",
] as const;
export type Scope = (typeof KNOWN_SCOPES)[number];

// Map from scope → capabilities the scope authorizes the bearer to use.
// Unknown / identity-only scopes map to empty arrays.
const SCOPE_CAPABILITY_GRANTS: Record<string, readonly string[]> = {
  "content.read": ["content.view"],
  "content.write": [
    "content.view",
    "content.author",
    "content.publish",
    "content.moderate",
  ],
};

export function intersectCapabilitiesWithScopes(
  effectiveCapabilities: readonly string[],
  scopes: readonly string[],
): string[] {
  const granted = new Set<string>();
  for (const scope of scopes) {
    for (const cap of SCOPE_CAPABILITY_GRANTS[scope] ?? []) {
      if (effectiveCapabilities.includes(cap)) granted.add(cap);
    }
  }
  return Array.from(granted).sort();
}

export function parseScopeParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

// ─── Token lifetimes ──────────────────────────────────────────────────────────

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const ID_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60; // 5 minutes

// ─── Hashing helpers ──────────────────────────────────────────────────────────

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newAuthorizationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

// ─── JWT signing ──────────────────────────────────────────────────────────────

interface BuildAccessTokenArgs {
  subject: string;
  clientId: string;
  scopes: string[];
  capabilities: string[];
  roles?: string[];
}

export async function signAccessToken(args: BuildAccessTokenArgs): Promise<string> {
  const key = await getActiveSigningKey();
  const privateKey = await importPKCS8(key.privateKeyPem, key.algorithm);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    scope: args.scopes.join(" "),
    cap: args.capabilities,
    // Empty in v1; populated by the per-client roles follow-up
    // (BACKLOG.md #128 §1). The claim is reserved here so adding it later
    // doesn't change the token shape downstream consumers see.
    roles: args.roles ?? [],
    typ: "access",
  })
    .setProtectedHeader({ alg: key.algorithm, kid: key.kid, typ: "JWT" })
    .setIssuer(siteOrigin())
    .setSubject(args.subject)
    .setAudience(args.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(privateKey);
  return jwt;
}

interface BuildIdTokenArgs {
  subject: string;
  clientId: string;
  scopes: string[];
  nonce: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export async function signIdToken(args: BuildIdTokenArgs): Promise<string> {
  const key = await getActiveSigningKey();
  const privateKey = await importPKCS8(key.privateKeyPem, key.algorithm);
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {};
  if (args.nonce) claims["nonce"] = args.nonce;
  if (args.scopes.includes("email") && args.email) {
    claims["email"] = args.email;
    claims["email_verified"] = args.emailVerified;
  }
  if (args.scopes.includes("profile")) {
    if (args.name) claims["name"] = args.name;
    if (args.picture) claims["picture"] = args.picture;
  }
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: key.algorithm, kid: key.kid, typ: "JWT" })
    .setIssuer(siteOrigin())
    .setSubject(args.subject)
    .setAudience(args.clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ID_TOKEN_TTL_SECONDS)
    .sign(privateKey);
  return jwt;
}
