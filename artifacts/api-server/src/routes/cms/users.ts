import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
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

const ProfileBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const router: IRouter = Router();

router.put(
  "/cms/profile",
  requireAuth,
  async (req, res) => {
    const parsed = ProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const userId = req.authedUser!.id;
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
    if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio;
    if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      bio: updated.bio,
    });
  },
);

const CONTENT_ROLES: RoleName[] = ["admin", "site_admin", "editor", "content_author", "author"];

router.get(
  "/cms/users",
  requireAuth,
  requireRole("admin", "editor"),
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
    const contentUsers = users.filter((u) => {
      const roles = rolesByUser.get(u.id) ?? [];
      return roles.some((r) => CONTENT_ROLES.includes(r));
    });
    res.json(
      contentUsers.map((u) => ({
        id: u.id,
        externalSubject: u.externalSubject,
        authProvider: u.authProvider,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
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
      externalSubject: user.externalSubject,
      authProvider: user.authProvider,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      roles: wantedNames,
      createdAt: user.createdAt.toISOString(),
    });
  },
);

export default router;
