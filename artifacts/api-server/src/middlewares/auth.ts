import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
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

export type AuthedUser = {
  id: string;
  externalSubject: string | null;
  authProvider: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  roles: RoleName[];
};

export async function loadUserById(userId: string): Promise<AuthedUser | null> {
  const userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!userRow) return null;
  const roleRows = await db
    .select({ name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, userId));
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
    const token = readSessionToken(req);
    if (!token) return next();
    const session = await resolveSession(token);
    if (!session) return next();
    const user = await loadUserById(session.userId);
    if (!user) {
      await destroySession(token);
      clearSessionCookie(req, res);
      return next();
    }
    req.session = session;
    req.authedUser = user;
    if (session.renewed) {
      setSessionCookie(req, res, token, session.expiresAt);
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

export function requireRole(...allowed: RoleName[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authedUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!user.roles.some((r) => allowed.includes(r))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function hasRole(user: AuthedUser | undefined, ...allowed: RoleName[]): boolean {
  return !!user && user.roles.some((r) => allowed.includes(r));
}
