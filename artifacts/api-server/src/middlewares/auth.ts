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
import { resolveSession } from "../lib/sessions";

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
export const attachUserIfPresent: RequestHandler = async (req, _res, next) => {
  try {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    let token = cookies?.["sid"] ?? null;
    if (!token) {
      const header = req.headers["cookie"];
      if (header) {
        for (const part of String(header).split(";")) {
          const [k, ...v] = part.trim().split("=");
          if (k === "sid") {
            token = decodeURIComponent(v.join("="));
            break;
          }
        }
      }
    }
    if (!token) return next();
    const session = await resolveSession(token);
    if (!session) return next();
    req.session = session;
    const user = await loadUserById(session.userId);
    if (user) req.authedUser = user;
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
