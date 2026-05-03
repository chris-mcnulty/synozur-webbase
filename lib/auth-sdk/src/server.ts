// Server-side helpers for consuming Synozur OAuth tokens.
//
// `verifyAccessToken` / `verifyIdToken` use a remote JWKS (cached by jose) and
// validate iss/aud/exp. `requireOidcUser` is an Express middleware factory
// that pulls a Bearer token off the Authorization header, verifies it, and
// attaches the parsed claims to `req` for downstream handlers.

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
  type JWTVerifyGetKey,
} from "jose";
import type { AccessTokenClaims, IdTokenClaims } from "./types";

export interface VerifierOptions {
  // The expected `iss` claim; this is also where /.well-known/jwks.json is
  // fetched from (`${issuer}/.well-known/jwks.json`).
  issuer: string;
  // The expected `aud` claim — i.e. the consuming app's `client_id`.
  audience: string;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(issuer: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

async function verifyJwt(
  token: string,
  opts: VerifierOptions,
): Promise<JWTVerifyResult> {
  const jwks = getJwks(opts.issuer);
  return jwtVerify(token, jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ["RS256"],
  });
}

function asAccessTokenClaims(payload: JWTPayload): AccessTokenClaims {
  return {
    iss: String(payload["iss"] ?? ""),
    sub: String(payload["sub"] ?? ""),
    aud: String(payload["aud"] ?? ""),
    iat: Number(payload["iat"] ?? 0),
    exp: Number(payload["exp"] ?? 0),
    scope: typeof payload["scope"] === "string" ? payload["scope"] : "",
    cap: Array.isArray(payload["cap"]) ? (payload["cap"] as string[]) : [],
    roles: Array.isArray(payload["roles"]) ? (payload["roles"] as string[]) : [],
    typ: "access",
  };
}

function asIdTokenClaims(payload: JWTPayload): IdTokenClaims {
  return {
    iss: String(payload["iss"] ?? ""),
    sub: String(payload["sub"] ?? ""),
    aud: String(payload["aud"] ?? ""),
    iat: Number(payload["iat"] ?? 0),
    exp: Number(payload["exp"] ?? 0),
    ...(typeof payload["nonce"] === "string" ? { nonce: payload["nonce"] } : {}),
    ...(typeof payload["email"] === "string" ? { email: payload["email"] } : {}),
    ...(typeof payload["email_verified"] === "boolean"
      ? { email_verified: payload["email_verified"] }
      : {}),
    ...(typeof payload["name"] === "string" ? { name: payload["name"] } : {}),
    ...(typeof payload["picture"] === "string"
      ? { picture: payload["picture"] }
      : {}),
  };
}

export async function verifyAccessToken(
  token: string,
  opts: VerifierOptions,
): Promise<AccessTokenClaims> {
  const { payload } = await verifyJwt(token, opts);
  if (payload["typ"] !== "access") {
    throw new Error("Token is not an access token (typ != 'access')");
  }
  return asAccessTokenClaims(payload);
}

export async function verifyIdToken(
  token: string,
  opts: VerifierOptions,
): Promise<IdTokenClaims> {
  const { payload } = await verifyJwt(token, opts);
  return asIdTokenClaims(payload);
}

// ─── Express middleware ──────────────────────────────────────────────────────

export interface RequireOidcUserOptions extends VerifierOptions {
  // Optional: require these scopes/capabilities to be present on the token.
  requiredScopes?: string[];
  requiredCapabilities?: string[];
}

// Minimal Express types so we don't take a hard runtime dep on express.
interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  oidc?: AccessTokenClaims;
}
interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): ExpressLikeResponse;
  json(body: unknown): void;
}
type NextFn = (err?: unknown) => void;

export function requireOidcUser(opts: RequireOidcUserOptions) {
  return async (
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    next: NextFn,
  ): Promise<void> => {
    const auth = req.headers["authorization"];
    const header = Array.isArray(auth) ? auth[0] : auth;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      res
        .status(401)
        .setHeader("WWW-Authenticate", 'Bearer realm="api"')
        .json({ error: "missing_bearer_token" });
      return;
    }
    const token = header.slice(7).trim();
    try {
      const claims = await verifyAccessToken(token, opts);
      if (opts.requiredScopes?.length) {
        const granted = new Set(claims.scope.split(/\s+/).filter(Boolean));
        if (!opts.requiredScopes.every((s) => granted.has(s))) {
          res.status(403).json({ error: "insufficient_scope" });
          return;
        }
      }
      if (opts.requiredCapabilities?.length) {
        if (!opts.requiredCapabilities.every((c) => claims.cap.includes(c))) {
          res.status(403).json({ error: "insufficient_capabilities" });
          return;
        }
      }
      req.oidc = claims;
      next();
    } catch {
      res
        .status(401)
        .setHeader("WWW-Authenticate", 'Bearer error="invalid_token"')
        .json({ error: "invalid_token" });
    }
  };
}
