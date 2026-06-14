import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
  capabilitiesTable,
  roleCapabilities,
  apiKeysTable,
  type RoleName,
  ROLE_NAMES,
} from "@workspace/db";
import {
  clearSessionCookie,
  destroySession,
  readSessionToken,
  resolveSession,
  setSessionCookie,
} from "../lib/sessions";
import { verifyOAuthAccessToken } from "../lib/oauthBearer";

export type AuthedUser = {
  id: string;
  externalSubject: string | null;
  authProvider: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  roles: RoleName[];
  // #111 — server-hydrated effective capabilities (union across the user's
  // roles, via the role_capabilities join). The SPA reads this directly
  // instead of recomputing from a static map.
  effectiveCapabilities: string[];
};

export async function loadUserById(userId: string): Promise<AuthedUser | null> {
  const userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!userRow) return null;
  const roleRows = await db
    .select({ id: rolesTable.id, name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, userId));
  const roleIds = roleRows.map((r) => r.id);
  let effectiveCapabilities: string[] = [];
  if (roleIds.length > 0) {
    const capRows = await db
      .selectDistinct({ name: capabilitiesTable.name })
      .from(roleCapabilities)
      .innerJoin(capabilitiesTable, eq(roleCapabilities.capabilityId, capabilitiesTable.id))
      .where(inArray(roleCapabilities.roleId, roleIds));
    effectiveCapabilities = capRows.map((r) => r.name).sort();
  }
  return {
    id: userRow.id,
    externalSubject: userRow.externalSubject,
    authProvider: userRow.authProvider,
    email: userRow.email,
    displayName: userRow.displayName,
    avatarUrl: userRow.avatarUrl,
    bio: userRow.bio,
    roles: roleRows
      .map((r) => r.name)
      .filter((n): n is RoleName => ROLE_NAMES.includes(n as RoleName)),
    effectiveCapabilities,
  };
}

// `attachUserIfPresent` resolves the cookie-bound session and hydrates
// `req.authedUser` if any. Mounted globally; downstream handlers decide
// whether to require auth.
//
// Two pieces of housekeeping happen here so callers don't have to think about
// session lifecycle:
//   1. If the session row was renewed by `resolveSession`, we re-issue the
//      cookie so the browser's own expiry stays in sync with the row's.
//   2. If a session resolves but the referenced user is gone (deleted, or
//      the auth provider link was rotated), we destroy the session row and
//      clear the cookie so we don't repeatedly look up a phantom user.
export const attachUserIfPresent: RequestHandler = async (req, res, next) => {
  try {
    // 1. Cookie-bound session (Synozur native auth — Entra-backed).
    const token = readSessionToken(req);
    if (token) {
      const session = await resolveSession(token);
      if (session) {
        const user = await loadUserById(session.userId);
        if (!user) {
          await destroySession(token);
          clearSessionCookie(req, res);
        } else {
          req.session = session;
          req.authedUser = user;
          if (session.renewed) {
            setSessionCookie(req, res, token, session.expiresAt);
          }
          return next();
        }
      }
    }

    // 2. OAuth Bearer token (#128) — downstream apps (Galaxy, partner portal,
    //    future internal tools) authenticate by presenting an access token
    //    issued by /oauth/token. Verified against the local JWKS and the
    //    user is hydrated from `usersTable`.
    const authHeader = req.headers["authorization"];
    if (authHeader && typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      const bearer = authHeader.slice(7).trim();
      if (bearer) {
        // 2a. API key — `syn_` prefix indicates a static machine-to-machine key.
        //     Hash it, look up in api_keys, confirm not revoked/expired, then
        //     synthesise a virtual authedUser carrying the key's capabilities.
        if (bearer.startsWith("syn_")) {
          const keyHash = createHash("sha256").update(bearer).digest("hex");
          const [keyRow] = await db
            .select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.keyHash, keyHash))
            .limit(1);
          if (keyRow && !keyRow.revokedAt && !(keyRow.expiresAt && keyRow.expiresAt < new Date())) {
            // Synthesise a virtual authedUser scoped to the key's granted capabilities.
            req.authedUser = {
              id: keyRow.id,
              externalSubject: null,
              authProvider: "api_key",
              email: null,
              displayName: keyRow.name,
              avatarUrl: null,
              bio: null,
              roles: [],
              effectiveCapabilities: keyRow.grantedCapabilities,
            };
            // Fire-and-forget usage telemetry — never fails the request.
            db.update(apiKeysTable)
              .set({
                lastUsedAt: new Date(),
                useCount: (keyRow.useCount ?? 0) + 1,
              })
              .where(eq(apiKeysTable.id, keyRow.id))
              .catch(() => {});
            return next();
          }
          // Invalid/revoked/expired syn_ key → do not fall through to OAuth.
          return next();
        }

        // 2b. OAuth access token (JWKS-verified JWT).
        const claims = await verifyOAuthAccessToken(bearer);
        if (claims) {
          const user = await loadUserById(claims.sub);
          if (user) {
            req.authedUser = user;
            req.oauthClaims = claims;
          }
        }
      }
    }
  } catch (err) {
    req.log?.warn({ err }, "attachUserIfPresent failed");
  }
  next();
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (!req.authedUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// For API-key callers (roles: []), map each role name to the capability
// that represents it so that existing `hasRole`/`requireRole` guards work
// transparently without touching every route file.
const ROLE_CAPABILITY_EQUIVALENT: Record<string, string> = {
  admin: "site.manage",
  site_admin: "site.manage",
  editor: "content.publish",
  content_author: "content.author",
  author: "content.author",
  contributor: "content.author",
  hr: "careers.jobs.read",
  internal: "content.view",
  customer: "portal.view",
};

function apiKeyMatchesRoles(user: AuthedUser, allowed: readonly RoleName[]): boolean {
  return allowed.some((role) => {
    const equiv = ROLE_CAPABILITY_EQUIVALENT[role];
    return equiv ? user.effectiveCapabilities.includes(equiv) : false;
  });
}

export function requireRole(...allowed: RoleName[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authedUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const satisfied =
      user.authProvider === "api_key"
        ? apiKeyMatchesRoles(user, allowed)
        : user.roles.some((r) => allowed.includes(r));
    if (!satisfied) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function hasRole(user: AuthedUser | undefined, ...allowed: RoleName[]): boolean {
  if (!user) return false;
  if (user.authProvider === "api_key") return apiKeyMatchesRoles(user, allowed);
  return user.roles.some((r) => allowed.includes(r));
}

// #111 — capability-based gate. Prefer this over requireRole() in new code:
// it survives role renames and lets admins re-grant a capability to a
// different audience class without code changes.
export function requireCapability(...needed: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authedUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!needed.some((cap) => user.effectiveCapabilities.includes(cap))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function hasCapability(user: AuthedUser | undefined, ...needed: string[]): boolean {
  return !!user && needed.some((cap) => user.effectiveCapabilities.includes(cap));
}
