import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, entraGroupRoleMappingsTable, rolesTable, ROLE_NAMES, type RoleName } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

// #126: admin CRUD over the Entra group → CMS role mapping table. Used by the
// /admin/access/entra page; reconciliation runs on the next sign-in for any
// user whose group set intersects the configured rows.
const router: IRouter = Router();

const RoleNameSchema = z.enum(ROLE_NAMES as readonly [RoleName, ...RoleName[]]);

const CreateMappingBody = z.object({
  entraGroupId: z.string().min(1).max(100),
  entraGroupName: z.string().max(200).nullish(),
  role: RoleNameSchema,
});

router.get("/admin/entra/group-mappings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: entraGroupRoleMappingsTable.id,
      entraGroupId: entraGroupRoleMappingsTable.entraGroupId,
      entraGroupName: entraGroupRoleMappingsTable.entraGroupName,
      roleName: rolesTable.name,
      roleId: rolesTable.id,
      createdAt: entraGroupRoleMappingsTable.createdAt,
    })
    .from(entraGroupRoleMappingsTable)
    .innerJoin(rolesTable, eq(entraGroupRoleMappingsTable.roleId, rolesTable.id))
    .orderBy(desc(entraGroupRoleMappingsTable.createdAt));
  res.json({ items: rows });
});

router.post("/admin/entra/group-mappings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateMappingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const role = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, parsed.data.role),
  });
  if (!role) {
    res.status(400).json({ error: `Unknown role: ${parsed.data.role}` });
    return;
  }
  const [row] = await db
    .insert(entraGroupRoleMappingsTable)
    .values({
      entraGroupId: parsed.data.entraGroupId,
      entraGroupName: parsed.data.entraGroupName ?? null,
      roleId: role.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    res.status(409).json({ error: "Mapping already exists" });
    return;
  }
  res.status(201).json({
    id: row.id,
    entraGroupId: row.entraGroupId,
    entraGroupName: row.entraGroupName,
    roleName: parsed.data.role,
    roleId: role.id,
    createdAt: row.createdAt,
  });
});

router.delete("/admin/entra/group-mappings/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const [row] = await db
    .delete(entraGroupRoleMappingsTable)
    .where(eq(entraGroupRoleMappingsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
