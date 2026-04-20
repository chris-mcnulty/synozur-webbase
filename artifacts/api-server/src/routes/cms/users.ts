import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
  ROLE_NAMES,
  type RoleName,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { audit } from "../../lib/audit";

const router: IRouter = Router();

router.get(
  "/cms/users",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    const users = await db.select().from(usersTable);
    const roleRows = await db
      .select({ userId: userRoles.userId, name: rolesTable.name })
      .from(userRoles)
      .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id));
    const rolesByUser = new Map<string, RoleName[]>();
    for (const r of roleRows) {
      const arr = rolesByUser.get(r.userId) ?? [];
      arr.push(r.name);
      rolesByUser.set(r.userId, arr);
    }
    res.json(
      users.map((u) => ({
        id: u.id,
        clerkUserId: u.clerkUserId,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        roles: rolesByUser.get(u.id) ?? [],
        createdAt: u.createdAt.toISOString(),
      })),
    );
  },
);

const RolesBody = z.object({
  roles: z.array(z.enum(ROLE_NAMES)),
});

router.put(
  "/cms/users/:id/roles",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const parsed = RolesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, String(req.params.id)),
    });
    if (!user) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const wantedNames = Array.from(new Set(parsed.data.roles));
    const allRoles = await db.select().from(rolesTable);
    const wantedIds = allRoles
      .filter((r) => wantedNames.includes(r.name))
      .map((r) => r.id);

    await db.delete(userRoles).where(eq(userRoles.userId, user.id));
    if (wantedIds.length) {
      await db
        .insert(userRoles)
        .values(wantedIds.map((roleId) => ({ userId: user.id, roleId })))
        .onConflictDoNothing();
    }

    await audit({
      actorId: req.authedUser!.id,
      action: "user.set_roles",
      entity: "user",
      entityId: user.id,
      diff: { roles: wantedNames },
    });

    res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      roles: wantedNames,
      createdAt: user.createdAt.toISOString(),
    });
  },
);

export default router;
