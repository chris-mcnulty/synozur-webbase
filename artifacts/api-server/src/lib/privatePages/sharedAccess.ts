import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { pool } from "@workspace/db";
import { PRIVATE_RESPONSE_HEADERS } from "./policy";

export const SHARED_COOKIE = "galaxy_shared";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const generateSharedPassword = () => randomBytes(24).toString("base64url");
export const SHARED_TTL_MS = 8 * 60 * 60 * 1000;

export function setSharedCookie(req: Request, res: Response, token: string | null) {
  res.cookie(SHARED_COOKIE, token ?? "", {
    httpOnly: true, secure: req.secure, sameSite: "strict", path: "/",
    maxAge: token ? SHARED_TTL_MS : 0,
  });
}

/** Browser requests only: custom header plus same-origin Origin or Fetch Metadata. */
export const privateWriteGuard: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  const expected = `${req.protocol}://${req.get("host")}`;
  if (req.get("x-galaxy-request") !== "1" ||
      (origin ? origin !== expected : site !== "same-origin")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};

export const confidentialHeaders: RequestHandler = (_req, res, next) => {
  res.set(PRIVATE_RESPONSE_HEADERS);
  // The app's global CORS policy must never expose confidential content.
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Credentials");
  next();
};

export function sharedRequestAllowed(method: string, path: string): boolean {
  if (method === "GET" || method === "HEAD") {
    return path === "/api/auth/shared/session" ||
      /^\/api\/private-pages(?:\/[0-9a-f-]+(?:\/(?:html|script|assets\/(?:html|audio|transcript)))?)?\/?$/i.test(path);
  }
  return method === "POST" &&
    ["/api/auth/shared/logout", "/api/auth/shared/login", "/api/auth/galaxy/login"].includes(path);
}

/**
 * Separate bounded, non-renewing cookie sessions. Shared identities never
 * receive OAuth/access/refresh tokens, so their bearer use always fails closed.
 * Live account, organization, mapping and roster checks run for every request.
 */
export const attachSharedAccess: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SHARED_COOKIE];
  if (!token) {
    if (req.authedUser?.authProvider === "shared_org") {
      res.set(PRIVATE_RESPONSE_HEADERS).status(403).json({ error: "Forbidden" });
      return;
    }
    next();
    return;
  }
  const result = await pool.query(`
    SELECT a.user_id, a.username, a.organization_id
    FROM shared_organization_sessions s
    JOIN shared_organization_accounts a ON a.id = s.account_id
    JOIN users u ON u.id = a.user_id
    JOIN client_organizations o ON o.id = a.organization_id
    JOIN client_organization_users m ON m.user_id = a.user_id AND m.client_organization_id = a.organization_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
      AND s.credential_version = a.credential_version AND NOT a.disabled
      AND o.is_active AND o.deleted_at IS NULL
      AND u.auth_provider = 'shared_org' AND u.client_organization_id = a.organization_id
  `, [digest(String(token))]);
  const row = result.rows[0];
  res.set(PRIVATE_RESPONSE_HEADERS);
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Credentials");
  if (!row) {
    setSharedCookie(req, res, null);
    // Never fall back to a native sid and silently enter a different identity.
    delete req.authedUser;
    delete req.session;
    if (req.path === "/api/auth/shared/session" || req.path === "/api/auth/shared/login" || req.path === "/api/auth/galaxy/login" ||
        req.path === "/api/auth/shared/logout") { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!sharedRequestAllowed(req.method, req.path)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  delete req.session;
  delete req.oauthClaims;
  req.authedUser = {
    id: row.user_id, authProvider: "shared_org", externalSubject: null,
    email: null, displayName: row.username, avatarUrl: null, bio: null,
    roles: ["customer"], effectiveCapabilities: [],
  };
  next();
};
