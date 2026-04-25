import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable, userRoles } from "@workspace/db";

export interface AdminInfo {
  userId: string;     // internal users.id (uuid)
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminInfo;
    }
  }
}

function getAllowedEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

// Resolves admin authorization off the cookie-bound session populated by
// `attachUserIfPresent`. Authority comes from ANY of:
//   1) email present in the ADMIN_EMAILS allow-list (env-controlled bootstrap)
//   2) an `admin` role grant in the user_roles table — the canonical signal
//      once #126 (Entra group → role mappings) is in active use
export async function getCurrentAdmin(
  req: Request,
): Promise<
  | { status: "unauthenticated" }
  | { status: "unauthorized"; email: string }
  | { status: "ok"; info: AdminInfo }
> {
  const user = req.authedUser;
  if (!user) return { status: "unauthenticated" };
  const email = (user.email ?? "").toLowerCase();
  const allowed = getAllowedEmails();

  // ADMIN_EMAILS bypass — always grants access if listed.
  if (allowed.length === 0 || allowed.includes(email)) {
    return { status: "ok", info: { userId: user.id, email } };
  }

  // Database-backed admin role.
  const adminGrant = await db
    .select({ name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, user.id));
  if (adminGrant.some((r) => r.name === "admin")) {
    return { status: "ok", info: { userId: user.id, email } };
  }
  return { status: "unauthorized", email };
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const result = await getCurrentAdmin(req);
  if (result.status === "unauthenticated") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (result.status === "unauthorized") {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  req.admin = result.info;
  next();
}

// Suppress unused-import warning for shared schema reference.
void usersTable;
