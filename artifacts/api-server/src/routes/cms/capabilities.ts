import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  rolesTable,
  capabilitiesTable,
  roleCapabilities,
  ROLE_NAMES,
  CAPABILITY_NAMES,
  type RoleName,
  type CapabilityName,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import { audit } from "../../lib/audit";

const router: IRouter = Router();

// #111 — DB-backed capability map admin surface.
//
// Every endpoint here is gated on `users.manage` (the same capability that
// guards the existing /admin/access/users page) so the role↔capability
// editor sits next to user-role assignment in the UI.

router.get(
  "/cms/access/capabilities",
  requireAuth,
  requireCapability("users.manage"),
  async (_req, res) => {
    const [caps, roles, grants] = await Promise.all([
      db.select().from(capabilitiesTable),
      db.select().from(rolesTable),
      db
        .select({
          roleId: roleCapabilities.roleId,
          capabilityId: roleCapabilities.capabilityId,
        })
        .from(roleCapabilities),
    ]);
    const capById = new Map(caps.map((c) => [c.id, c.name]));
    const grantsByRole = new Map<string, string[]>();
    for (const g of grants) {
      const capName = capById.get(g.capabilityId);
      if (!capName) continue;
      const arr = grantsByRole.get(g.roleId) ?? [];
      arr.push(capName);
      grantsByRole.set(g.roleId, arr);
    }
    res.json({
      capabilities: caps
        .map((c) => ({ id: c.id, name: c.name, description: c.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: roles
        .map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          capabilities: (grantsByRole.get(r.id) ?? []).sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  },
);

const SetRoleCapabilitiesParams = z.object({
  role: z.enum(ROLE_NAMES as readonly [RoleName, ...RoleName[]]),
});
const SetRoleCapabilitiesBody = z.object({
  capabilities: z.array(z.enum(CAPABILITY_NAMES as readonly [CapabilityName, ...CapabilityName[]])),
});

router.put(
  "/cms/access/roles/:role/capabilities",
  requireAuth,
  requireCapability("users.manage"),
  async (req, res) => {
    const params = SetRoleCapabilitiesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown role" });
      return;
    }
    const body = SetRoleCapabilitiesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
      return;
    }
    const role = await db.query.rolesTable.findFirst({
      where: eq(rolesTable.name, params.data.role),
    });
    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }
    const wantedNames = Array.from(new Set(body.data.capabilities));
    const wantedCaps = wantedNames.length
      ? await db
          .select()
          .from(capabilitiesTable)
          .where(inArray(capabilitiesTable.name, wantedNames))
      : [];
    const wantedIds = wantedCaps.map((c) => c.id);

    // Atomic swap: a crash between DELETE and INSERT would otherwise leave
    // the role with zero grants and lock admins out of users.manage.
    await db.transaction(async (tx) => {
      await tx.delete(roleCapabilities).where(eq(roleCapabilities.roleId, role.id));
      if (wantedIds.length) {
        await tx
          .insert(roleCapabilities)
          .values(wantedIds.map((capabilityId) => ({ roleId: role.id, capabilityId })))
          .onConflictDoNothing();
      }
    });

    await audit({
      actorId: req.authedUser!.id,
      action: "role.set_capabilities",
      entity: "role",
      entityId: role.id,
      diff: { role: role.name, capabilities: wantedNames },
    });

    res.json({ role: role.name, capabilities: wantedNames.sort() });
  },
);

export default router;
