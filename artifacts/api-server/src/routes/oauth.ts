/**
 * OAuth 2.0 / OIDC provider routes — #128 Phase B.
 *
 * Mounted at site root (not under /api/) so /.well-known/* and /oauth/*
 * appear at the origin directly, as required by RFC 8414 and OIDC Discovery.
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration  — OIDC discovery document
 *   GET  /.well-known/jwks.json             — published RS256 public keys
 *   GET  /oauth/authorize                   — start authorization flow
 *   POST /oauth/authorize/decision          — consent form target
 *   POST /oauth/token                       — exchange code / rotate refresh token
 *   GET  /oauth/userinfo                    — bearer-authenticated user claims
 */

import { createHash } from "crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  exportJWK,
  importSPKI,
  jwtVerify,
  createLocalJWKSet,
  type JWK,
} from "jose";
import { z } from "zod";
import {
  db,
  oauthClientsTable,
  oauthAuthorizationCodesTable,
  oauthRefreshTokensTable,
  oauthConsentsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, loadUserById } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { getPublishedKeys } from "../lib/oauthKeys";
import {
  KNOWN_SCOPES,
  parseScopeParam,
  intersectCapabilitiesWithScopes,
  signAccessToken,
  signIdToken,
  sha256Hex,
  newAuthorizationCode,
  newRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
} from "../lib/oauthTokens";
import { renderConsentScreen, describeScope } from "../lib/oauthConsentRender";
import { siteOrigin } from "../lib/siteOrigin";

const router: IRouter = Router();

// ─── CSRF helper ──────────────────────────────────────────────────────────────
//
// Belt-and-suspenders: the session cookie is SameSite=Lax so cross-site POST
// can't include it, but we add an explicit token to be safe.
// We derive the CSRF token from the session id (the SHA-256 hash of the raw
// session token stored server-side) so it's per-session and unpredictable
// to anyone who doesn't have the cookie.

function makeConsentCsrfToken(sessionId: string): string {
  return createHash("sha256")
    .update(sessionId)
    .update("|oauth-consent-csrf")
    .digest("hex");
}

// ─── JWKS builder (with short-lived module-level cache) ───────────────────────
//
// Caching avoids hitting the DB and re-running RSA PEM→JWK conversion on
// every /oauth/userinfo request. TTL matches the JWKS endpoint's
// Cache-Control: public, max-age=300 header.
const JWKS_CACHE_TTL_MS = 60_000; // 60 s
let _jwksCache: { keys: JWK[] } | null = null;
let _jwksCacheExpiry = 0;

async function buildJwks(): Promise<{ keys: JWK[] }> {
  const now = Date.now();
  if (_jwksCache && now < _jwksCacheExpiry) {
    return _jwksCache;
  }
  const published = await getPublishedKeys();
  const keys: JWK[] = await Promise.all(
    published.map(async (k) => {
      const pubKey = await importSPKI(k.publicKeyPem, k.algorithm);
      const jwk = await exportJWK(pubKey);
      return { ...jwk, kid: k.kid, alg: k.algorithm, use: "sig" };
    }),
  );
  _jwksCache = { keys };
  _jwksCacheExpiry = now + JWKS_CACHE_TTL_MS;
  return _jwksCache;
}

// ─── OIDC Discovery ───────────────────────────────────────────────────────────

router.get("/.well-known/openid-configuration", (_req, res) => {
  const origin = siteOrigin();
  res.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    userinfo_endpoint: `${origin}/oauth/userinfo`,
    jwks_uri: `${origin}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: [...KNOWN_SCOPES],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "iat",
      "exp",
      "nonce",
      "email",
      "email_verified",
      "name",
      "picture",
    ],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
  });
});

// ─── JWKS endpoint ────────────────────────────────────────────────────────────

router.get("/.well-known/jwks.json", async (_req, res): Promise<void> => {
  try {
    const jwks = await buildJwks();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(jwks);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Shared schema for authorize parameters ───────────────────────────────────

const AuthorizeParamsSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(256),
  redirect_uri: z.string().url().max(2048),
  scope: z.string().min(1).max(1024),
  state: z.string().max(512).optional(),
  code_challenge: z.string().max(256).optional(),
  code_challenge_method: z.literal("S256").optional(),
  nonce: z.string().max(512).optional(),
});

// ─── Authorization endpoint ──────────────────────────────────────────────────

router.get("/oauth/authorize", async (req, res): Promise<void> => {
  // Coerce query params into a plain object (Express 5 may return arrays for
  // repeated params; we take the first string value in each case).
  const q = (key: string): string | undefined => {
    const val = req.query[key];
    if (typeof val === "string") return val;
    if (Array.isArray(val) && typeof val[0] === "string") return val[0];
    return undefined;
  };

  const rawParams = {
    response_type: q("response_type"),
    client_id: q("client_id"),
    redirect_uri: q("redirect_uri"),
    scope: q("scope"),
    state: q("state"),
    code_challenge: q("code_challenge"),
    code_challenge_method: q("code_challenge_method"),
    nonce: q("nonce"),
  };

  // Basic validation before any DB call — errors here can't be redirect-based
  // because we may not yet have a validated redirect_uri.
  const parsed = AuthorizeParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const {
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    nonce,
  } = parsed.data;

  // Validate client
  const [client] = await db
    .select()
    .from(oauthClientsTable)
    .where(eq(oauthClientsTable.clientId, clientId))
    .limit(1);

  if (!client || !client.isActive) {
    res.status(400).json({ error: "invalid_client" });
    return;
  }

  // redirect_uri must match exactly
  if (!client.redirectUris.includes(redirectUri)) {
    res.status(400).json({ error: "invalid_redirect_uri" });
    return;
  }

  // From here we can use redirect-based errors since redirect_uri is validated.
  function redirectError(code: string, description?: string): void {
    const u = new URL(redirectUri);
    u.searchParams.set("error", code);
    if (description) u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    res.redirect(u.toString());
  }

  // Client must support authorization_code grant
  if (!client.allowedGrantTypes.includes("authorization_code")) {
    redirectError("unauthorized_client");
    return;
  }

  // Validate requested scopes ⊆ client.allowedScopes
  const requestedScopes = parseScopeParam(scope);
  if (requestedScopes.some((s) => !client.allowedScopes.includes(s))) {
    redirectError("invalid_scope");
    return;
  }

  // PKCE check
  if (client.pkceRequired && !codeChallenge) {
    redirectError("invalid_request", "code_challenge required for this client");
    return;
  }

  // Require sign-in
  if (!req.authedUser) {
    res.redirect(
      `/sign-in?returnTo=${encodeURIComponent(req.originalUrl)}`,
    );
    return;
  }

  const userId = req.authedUser.id;
  const sessionId = req.session!.id;

  // Check for existing unexpired consent that covers all requested scopes
  const [existingConsent] = await db
    .select()
    .from(oauthConsentsTable)
    .where(
      and(
        eq(oauthConsentsTable.userId, userId),
        eq(oauthConsentsTable.clientId, clientId),
        isNull(oauthConsentsTable.revokedAt),
      ),
    )
    .limit(1);

  const hasConsent =
    !!existingConsent &&
    requestedScopes.every((s) => existingConsent.scopesGranted.includes(s));

  if (hasConsent) {
    // Skip the consent screen and issue the code directly
    await issueAuthorizationCode({
      clientId,
      userId,
      redirectUri,
      requestedScopes,
      codeChallenge,
      codeChallengeMethod,
      nonce,
      state,
      res,
      skipConsent: true,
    });
    return;
  }

  // Render the consent screen
  const csrfToken = makeConsentCsrfToken(sessionId);
  const html = renderConsentScreen({
    clientName: client.name,
    clientDescription: client.description,
    scopeRows: requestedScopes.map((s) => ({
      scope: s,
      description: describeScope(s),
    })),
    hiddenFields: {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      ...(state ? { state } : {}),
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(codeChallengeMethod
        ? { code_challenge_method: codeChallengeMethod }
        : {}),
      ...(nonce ? { nonce } : {}),
    },
    csrfToken,
    decisionUrl: "/oauth/authorize/decision",
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ─── Authorization decision (consent form target) ─────────────────────────────

router.post(
  "/oauth/authorize/decision",
  requireAuth,
  async (req, res): Promise<void> => {
    const sessionId = req.session!.id;

    // CSRF verification
    const submittedCsrf = String(req.body["csrf_token"] ?? "");
    const expectedCsrf = makeConsentCsrfToken(sessionId);
    if (submittedCsrf !== expectedCsrf) {
      res.status(403).json({ error: "invalid_csrf_token" });
      return;
    }

    // Re-parse all authorize parameters from the form as untrusted input
    const rawParams = {
      response_type: req.body["response_type"] ?? "code",
      client_id: req.body["client_id"],
      redirect_uri: req.body["redirect_uri"],
      scope: req.body["scope"],
      state: req.body["state"],
      code_challenge: req.body["code_challenge"],
      code_challenge_method: req.body["code_challenge_method"],
      nonce: req.body["nonce"],
    };

    const parsed = AuthorizeParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      nonce,
    } = parsed.data;

    // Re-validate client
    const [client] = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.clientId, clientId))
      .limit(1);

    if (!client || !client.isActive) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    if (!client.redirectUris.includes(redirectUri)) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }

    function redirectError(code: string, description?: string): void {
      const u = new URL(redirectUri);
      u.searchParams.set("error", code);
      if (description) u.searchParams.set("error_description", description);
      if (state) u.searchParams.set("state", state);
      res.redirect(u.toString());
    }

    const requestedScopes = parseScopeParam(scope);
    if (requestedScopes.some((s) => !client.allowedScopes.includes(s))) {
      redirectError("invalid_scope");
      return;
    }

    if (client.pkceRequired && !codeChallenge) {
      redirectError("invalid_request", "code_challenge required");
      return;
    }

    const userId = req.authedUser!.id;
    const decision = String(req.body["decision"] ?? "");

    if (decision === "deny") {
      await audit({
        actorId: userId,
        action: "oauth.consent_denied",
        entity: "oauth_client",
        entityId: clientId,
        diff: { scopes: requestedScopes },
      });
      const u = new URL(redirectUri);
      u.searchParams.set("error", "access_denied");
      if (state) u.searchParams.set("state", state);
      res.redirect(u.toString());
      return;
    }

    if (decision !== "approve") {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    // Upsert consent record
    await db
      .insert(oauthConsentsTable)
      .values({
        userId,
        clientId,
        scopesGranted: requestedScopes,
        grantedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [oauthConsentsTable.userId, oauthConsentsTable.clientId],
        set: {
          scopesGranted: requestedScopes,
          grantedAt: new Date(),
          revokedAt: null,
        },
      });

    await audit({
      actorId: userId,
      action: "oauth.consent_granted",
      entity: "oauth_client",
      entityId: clientId,
      diff: { scopes: requestedScopes },
    });

    await issueAuthorizationCode({
      clientId,
      userId,
      redirectUri,
      requestedScopes,
      codeChallenge,
      codeChallengeMethod,
      nonce,
      state,
      res,
      skipConsent: false,
    });
  },
);

// ─── Helper: insert an auth code and redirect ─────────────────────────────────

async function issueAuthorizationCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  requestedScopes: string[];
  codeChallenge: string | undefined;
  codeChallengeMethod: string | undefined;
  nonce: string | undefined;
  state: string | undefined;
  res: import("express").Response;
  skipConsent: boolean;
}): Promise<void> {
  const code = newAuthorizationCode();
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000);

  await db.insert(oauthAuthorizationCodesTable).values({
    codeHash,
    clientId: args.clientId,
    userId: args.userId,
    redirectUri: args.redirectUri,
    scopes: args.requestedScopes,
    codeChallenge: args.codeChallenge ?? null,
    codeChallengeMethod: args.codeChallengeMethod ?? null,
    nonce: args.nonce ?? null,
    expiresAt,
  });

  await audit({
    actorId: args.userId,
    action: "oauth.authorize",
    entity: "oauth_client",
    entityId: args.clientId,
    diff: { scopes: args.requestedScopes, skippedConsent: args.skipConsent },
  });

  const redirectUrl = new URL(args.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (args.state) redirectUrl.searchParams.set("state", args.state);
  args.res.redirect(redirectUrl.toString());
}

// ─── Token endpoint ───────────────────────────────────────────────────────────

// Authenticate the calling client via HTTP Basic or form-field credentials.
async function authenticateOAuthClient(
  req: Request,
): Promise<(typeof oauthClientsTable.$inferSelect) | null> {
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
    // HTTP Basic: Authorization: Basic base64(client_id:client_secret)
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    clientId = decodeURIComponent(decoded.slice(0, sep));
    clientSecret = decodeURIComponent(decoded.slice(sep + 1));
  } else {
    clientId = req.body["client_id"]
      ? String(req.body["client_id"])
      : undefined;
    clientSecret = req.body["client_secret"]
      ? String(req.body["client_secret"])
      : undefined;
  }

  if (!clientId || !clientSecret) return null;

  const [client] = await db
    .select()
    .from(oauthClientsTable)
    .where(eq(oauthClientsTable.clientId, clientId))
    .limit(1);

  if (!client || !client.isActive) return null;

  const secretMatches = await bcrypt.compare(
    clientSecret,
    client.clientSecretHash,
  );
  if (!secretMatches) return null;

  return client;
}

router.post("/oauth/token", async (req, res): Promise<void> => {
  const client = await authenticateOAuthClient(req);
  if (!client) {
    res
      .status(401)
      .setHeader("WWW-Authenticate", "Basic")
      .json({ error: "invalid_client" });
    return;
  }

  const grantType = String(req.body["grant_type"] ?? "");
  const now = new Date();

  // ── authorization_code grant ───────────────────────────────────────────────
  if (grantType === "authorization_code") {
    if (!client.allowedGrantTypes.includes("authorization_code")) {
      res.status(400).json({ error: "unauthorized_client" });
      return;
    }

    const codeRaw = req.body["code"] ? String(req.body["code"]) : "";
    const redirectUri = req.body["redirect_uri"]
      ? String(req.body["redirect_uri"])
      : "";
    const codeVerifier = req.body["code_verifier"]
      ? String(req.body["code_verifier"])
      : undefined;

    if (!codeRaw || !redirectUri) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const codeHash = sha256Hex(codeRaw);

    // Atomically consume the code (CAS: consumed_at IS NULL AND expires_at > now)
    const [codeRow] = await db
      .update(oauthAuthorizationCodesTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oauthAuthorizationCodesTable.codeHash, codeHash),
          isNull(oauthAuthorizationCodesTable.consumedAt),
          gt(oauthAuthorizationCodesTable.expiresAt, now),
        ),
      )
      .returning();

    if (!codeRow) {
      // Check if this code was already consumed — replay attack detection
      const [consumed] = await db
        .select()
        .from(oauthAuthorizationCodesTable)
        .where(eq(oauthAuthorizationCodesTable.codeHash, codeHash))
        .limit(1);

      if (consumed) {
        // Code replay: revoke active refresh tokens for this user+client pair.
        // Scoped to the user who originally authorized the code so a replay of
        // one user's code doesn't revoke another user's tokens for the same client.
        await db
          .update(oauthRefreshTokensTable)
          .set({ revokedAt: now })
          .where(
            and(
              eq(oauthRefreshTokensTable.clientId, client.clientId),
              eq(oauthRefreshTokensTable.userId, consumed.userId),
              isNull(oauthRefreshTokensTable.revokedAt),
            ),
          );
        await audit({
          actorId: consumed.userId,
          action: "oauth.replay_detected",
          entity: "oauth_client",
          entityId: client.clientId,
          diff: { grantType: "authorization_code" },
        });
      }

      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Code must have been issued for this client
    if (codeRow.clientId !== client.clientId) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // redirect_uri must match exactly
    if (codeRow.redirectUri !== redirectUri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // PKCE: if the code has a challenge, the verifier must satisfy it
    if (codeRow.codeChallenge) {
      if (!codeVerifier) {
        res
          .status(400)
          .json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }
      const method = codeRow.codeChallengeMethod ?? "S256";
      const computedChallenge =
        method === "S256"
          ? createHash("sha256").update(codeVerifier).digest("base64url")
          : codeVerifier; // plain (legacy; only reachable for codes issued before S256-only enforcement)

      if (computedChallenge !== codeRow.codeChallenge) {
        res
          .status(400)
          .json({ error: "invalid_grant", error_description: "code_verifier does not match code_challenge" });
        return;
      }
    }

    // Load the user
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, codeRow.userId))
      .limit(1);

    if (!user) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const scopes = codeRow.scopes;
    const authedUser = await loadUserById(user.id);
    const capabilities = authedUser
      ? intersectCapabilitiesWithScopes(authedUser.effectiveCapabilities, scopes)
      : [];

    const accessToken = await signAccessToken({
      subject: user.id,
      clientId: client.clientId,
      scopes,
      capabilities,
    });

    let idToken: string | undefined;
    if (scopes.includes("openid")) {
      idToken = await signIdToken({
        subject: user.id,
        clientId: client.clientId,
        scopes,
        nonce: codeRow.nonce,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.displayName,
        picture: user.avatarUrl,
      });
    }

    let refreshTokenValue: string | undefined;
    if (
      scopes.includes("offline_access") &&
      client.allowedGrantTypes.includes("refresh_token")
    ) {
      refreshTokenValue = newRefreshToken();
      await db.insert(oauthRefreshTokensTable).values({
        tokenHash: sha256Hex(refreshTokenValue),
        clientId: client.clientId,
        userId: user.id,
        scopes,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      });
    }

    await db
      .update(oauthClientsTable)
      .set({ lastUsedAt: now })
      .where(eq(oauthClientsTable.id, client.id));

    await audit({
      actorId: user.id,
      action: "oauth.token_issued",
      entity: "oauth_client",
      entityId: client.clientId,
      diff: { scopes, grantType: "authorization_code" },
    });

    const responseBody: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    };
    if (idToken) responseBody["id_token"] = idToken;
    if (refreshTokenValue) responseBody["refresh_token"] = refreshTokenValue;

    res.setHeader("Cache-Control", "no-store").json(responseBody);
    return;
  }

  // ── refresh_token grant ────────────────────────────────────────────────────
  if (grantType === "refresh_token") {
    if (!client.allowedGrantTypes.includes("refresh_token")) {
      res.status(400).json({ error: "unauthorized_client" });
      return;
    }

    const refreshTokenRaw = req.body["refresh_token"]
      ? String(req.body["refresh_token"])
      : "";
    if (!refreshTokenRaw) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const tokenHash = sha256Hex(refreshTokenRaw);

    const [tokenRow] = await db
      .select()
      .from(oauthRefreshTokensTable)
      .where(eq(oauthRefreshTokensTable.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRow || tokenRow.clientId !== client.clientId) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Replay detection: token already revoked — revoke whole chain
    if (tokenRow.revokedAt) {
      await db
        .update(oauthRefreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthRefreshTokensTable.clientId, client.clientId),
            eq(oauthRefreshTokensTable.userId, tokenRow.userId),
            isNull(oauthRefreshTokensTable.revokedAt),
          ),
        );
      await audit({
        actorId: tokenRow.userId,
        action: "oauth.replay_detected",
        entity: "oauth_client",
        entityId: client.clientId,
        diff: { grantType: "refresh_token" },
      });
      await audit({
        actorId: tokenRow.userId,
        action: "oauth.refresh_revoked",
        entity: "oauth_client",
        entityId: client.clientId,
      });
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Token expired
    if (tokenRow.expiresAt.getTime() < now.getTime()) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Rotate: atomically revoke the old token and insert the new one in a
    // single transaction. The conditional UPDATE (WHERE revokedAt IS NULL)
    // is the compare-and-swap: if a concurrent request already rotated this
    // token the UPDATE matches zero rows, we detect the race, and treat it
    // as a replay to limit blast radius.
    const newRefreshTokenValue = newRefreshToken();
    const rotated = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(oauthRefreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthRefreshTokensTable.id, tokenRow.id),
            isNull(oauthRefreshTokensTable.revokedAt),
          ),
        )
        .returning({ id: oauthRefreshTokensTable.id });
      if (!updated) return false;
      await tx.insert(oauthRefreshTokensTable).values({
        tokenHash: sha256Hex(newRefreshTokenValue),
        clientId: client.clientId,
        userId: tokenRow.userId,
        scopes: tokenRow.scopes,
        parentTokenId: tokenRow.id,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      });
      return true;
    });

    if (!rotated) {
      // Lost the CAS race — a concurrent request already rotated this token.
      // Revoke the entire user+client family and reject.
      await db
        .update(oauthRefreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(oauthRefreshTokensTable.clientId, client.clientId),
            eq(oauthRefreshTokensTable.userId, tokenRow.userId),
            isNull(oauthRefreshTokensTable.revokedAt),
          ),
        );
      await audit({
        actorId: tokenRow.userId,
        action: "oauth.replay_detected",
        entity: "oauth_client",
        entityId: client.clientId,
        diff: { grantType: "refresh_token", reason: "concurrent_rotation" },
      });
      await audit({
        actorId: tokenRow.userId,
        action: "oauth.refresh_revoked",
        entity: "oauth_client",
        entityId: client.clientId,
      });
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, tokenRow.userId))
      .limit(1);

    if (!user) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const scopes = tokenRow.scopes;
    const authedUser = await loadUserById(user.id);
    const capabilities = authedUser
      ? intersectCapabilitiesWithScopes(authedUser.effectiveCapabilities, scopes)
      : [];

    const accessToken = await signAccessToken({
      subject: user.id,
      clientId: client.clientId,
      scopes,
      capabilities,
    });

    let idToken: string | undefined;
    if (scopes.includes("openid")) {
      idToken = await signIdToken({
        subject: user.id,
        clientId: client.clientId,
        scopes,
        nonce: null,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.displayName,
        picture: user.avatarUrl,
      });
    }

    await db
      .update(oauthClientsTable)
      .set({ lastUsedAt: now })
      .where(eq(oauthClientsTable.id, client.id));

    await audit({
      actorId: user.id,
      action: "oauth.token_refreshed",
      entity: "oauth_client",
      entityId: client.clientId,
      diff: { scopes },
    });

    const responseBody: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
      refresh_token: newRefreshTokenValue,
    };
    if (idToken) responseBody["id_token"] = idToken;

    res.setHeader("Cache-Control", "no-store").json(responseBody);
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

// ─── Userinfo endpoint ────────────────────────────────────────────────────────

router.get("/oauth/userinfo", async (req, res): Promise<void> => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    res
      .status(401)
      .setHeader("WWW-Authenticate", 'Bearer realm="userinfo"')
      .json({ error: "invalid_token" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const jwksData = await buildJwks();
    const JWKS = createLocalJWKSet(jwksData);

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: siteOrigin(),
    });

    // Reject ID tokens and any other non-access tokens. Access tokens issued
    // by this server carry `typ: "access"` in the payload claims.
    if (payload["typ"] !== "access") {
      res
        .status(401)
        .setHeader("WWW-Authenticate", 'Bearer realm="userinfo", error="invalid_token"')
        .json({ error: "invalid_token" });
      return;
    }

    const userId = payload.sub;
    if (!userId) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const scopeStr =
      typeof payload["scope"] === "string" ? payload["scope"] : "";
    const scopes = parseScopeParam(scopeStr);

    const claims: Record<string, unknown> = { sub: user.id };
    if (scopes.includes("email") && user.email) {
      claims["email"] = user.email;
      claims["email_verified"] = user.emailVerified;
    }
    if (scopes.includes("profile")) {
      if (user.displayName) claims["name"] = user.displayName;
      if (user.avatarUrl) claims["picture"] = user.avatarUrl;
    }

    res.setHeader("Cache-Control", "no-store").json(claims);
  } catch {
    res
      .status(401)
      .setHeader(
        "WWW-Authenticate",
        'Bearer realm="userinfo", error="invalid_token"',
      )
      .json({ error: "invalid_token" });
  }
});

export default router;
