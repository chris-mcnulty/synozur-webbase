import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable, userRoles, siteSettingsTable, type RoleName, ROLE_NAMES } from "@workspace/db";
import { applyEntraSignIn } from "../lib/entra";

export type AuthedUser = {
  id: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  roles: RoleName[];
};

async function loadOrCreateUser(clerkUserId: string): Promise<AuthedUser> {
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkUserId, clerkUserId),
  });

  let userId: string;
  let userRow: typeof usersTable.$inferSelect;
  let clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>> | null = null;
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId);
  } catch {
    // best-effort: clerk API may be unreachable in dev
  }

  if (existing) {
    userRow = existing;
    userId = existing.id;
  } else {
    let email: string | null = null;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    if (clerkUser) {
      email =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser!.primaryEmailAddressId)
          ?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        null;
      const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
      displayName = fullName || clerkUser.username || null;
      avatarUrl = clerkUser.imageUrl ?? null;
    }

    const [inserted] = await db
      .insert(usersTable)
      .values({ clerkUserId, email, displayName, avatarUrl })
      .returning();
    userRow = inserted;
    userId = inserted.id;

    // Bootstrap: first user becomes admin.
    const userCount = await db.$count(usersTable);
    if (userCount === 1) {
      const adminRole = await db.query.rolesTable.findFirst({
        where: eq(rolesTable.name, "admin"),
      });
      if (adminRole) {
        await db
          .insert(userRoles)
          .values({ userId, roleId: adminRole.id })
          .onConflictDoNothing();
      }
    }
  }

  // Auto-restore admin role for any email listed in ADMIN_EMAILS.
  // This survives DB resets: the next sign-in re-grants the role automatically.
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  const userEmail = userRow.email?.toLowerCase() ?? "";
  if (adminEmails.length > 0 && userEmail && adminEmails.includes(userEmail)) {
    const adminRole = await db.query.rolesTable.findFirst({
      where: eq(rolesTable.name, "admin"),
    });
    if (adminRole) {
      await db
        .insert(userRoles)
        .values({ userId: userRow.id, roleId: adminRole.id })
        .onConflictDoNothing();
    }
  }

  // #126: if the user authenticated via Microsoft/Entra, mirror the tenant +
  // object id, refresh group claims via Graph, and reconcile roles against
  // the entra_group_role_mappings table. This is purely additive — non-Entra
  // sign-ins fall through with no DB writes.
  if (clerkUser) {
    const settings = await db.query.siteSettingsTable.findFirst({
      where: eq(siteSettingsTable.id, 1),
    });
    if (!settings || settings.entraEnabled !== false) {
      try {
        await applyEntraSignIn(
          clerkUserId,
          userRow.id,
          clerkUser as unknown as Parameters<typeof applyEntraSignIn>[2],
          settings?.entraAdminGroupFallback ?? null,
        );
      } catch (err) {
        // Failures here must never block sign-in. Log and continue — the user
        // gets whatever roles they had before the failed reconciliation.
        // eslint-disable-next-line no-console
        console.warn("applyEntraSignIn failed", err);
      }
    }
  }

  const roleRows = await db
    .select({ name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, userId));

  return {
    id: userRow.id,
    clerkUserId: userRow.clerkUserId,
    email: userRow.email,
    displayName: userRow.displayName,
    avatarUrl: userRow.avatarUrl,
    bio: userRow.bio,
    roles: roleRows.map((r) => r.name).filter((n): n is RoleName => ROLE_NAMES.includes(n as RoleName)),
  };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.authedUser) {
      req.authedUser = await loadOrCreateUser(clerkUserId);
    }
    next();
  } catch (err) {
    req.log.error({ err }, "requireAuth failed");
    res.status(500).json({ error: "Internal authentication error" });
  }
};

/** Optional auth: attaches authedUser if signed in, otherwise continues. */
export const attachUserIfPresent: RequestHandler = async (req, _res, next) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (clerkUserId && !req.authedUser) {
      req.authedUser = await loadOrCreateUser(clerkUserId);
    }
  } catch (err) {
    req.log.warn({ err }, "attachUserIfPresent failed");
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
