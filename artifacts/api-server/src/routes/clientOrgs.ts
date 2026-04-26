import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clientOrganizationsTable,
  rolesTable,
  usersTable,
  userRoles,
  ROLE_NAMES,
  type RoleName,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { applyClientOrgRole } from "../lib/entra";
import { sendOrgApproved } from "../lib/email";

// Admin CRUD for client organizations. Organizations are the unit of client
// access — any user (Entra SSO or email/password) linked to an active org
// automatically receives the org's defaultRole on every sign-in.

const router: IRouter = Router();

const RoleNameSchema = z.enum(ROLE_NAMES as readonly [RoleName, ...RoleName[]]);

const CreateOrgBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  entraTenantId: z.string().uuid("Must be a valid GUID").nullish(),
  entraTenantName: z.string().max(255).nullish(),
  approvedEmailDomains: z.array(z.string().max(255)).max(50).optional(),
  isActive: z.boolean().optional(),
  defaultRole: RoleNameSchema.nullish(),
  notes: z.string().max(2000).nullish(),
});

const UpdateOrgBody = CreateOrgBody.partial();

const AssignUserBody = z.object({
  userId: z.string().uuid(),
});

// GET /api/admin/client-orgs
router.get("/admin/client-orgs", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: clientOrganizationsTable.id,
      name: clientOrganizationsTable.name,
      slug: clientOrganizationsTable.slug,
      entraTenantId: clientOrganizationsTable.entraTenantId,
      entraTenantName: clientOrganizationsTable.entraTenantName,
      approvedEmailDomains: clientOrganizationsTable.approvedEmailDomains,
      isActive: clientOrganizationsTable.isActive,
      autoCreated: clientOrganizationsTable.autoCreated,
      defaultRoleId: clientOrganizationsTable.defaultRoleId,
      defaultRoleName: rolesTable.name,
      notes: clientOrganizationsTable.notes,
      createdAt: clientOrganizationsTable.createdAt,
    })
    .from(clientOrganizationsTable)
    .leftJoin(rolesTable, eq(clientOrganizationsTable.defaultRoleId, rolesTable.id))
    .orderBy(desc(clientOrganizationsTable.createdAt));
  res.json({ items: rows });
});

// POST /api/admin/client-orgs
router.post("/admin/client-orgs", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateOrgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { name, slug, entraTenantId, entraTenantName, approvedEmailDomains, isActive, defaultRole, notes } = parsed.data;

  let defaultRoleId: string | null = null;
  if (defaultRole) {
    const role = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, defaultRole) });
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${defaultRole}` });
      return;
    }
    defaultRoleId = role.id;
  }

  const [row] = await db
    .insert(clientOrganizationsTable)
    .values({
      name,
      slug,
      entraTenantId: entraTenantId ?? null,
      entraTenantName: entraTenantName ?? null,
      approvedEmailDomains: approvedEmailDomains ?? [],
      isActive: isActive ?? true,
      defaultRoleId,
      notes: notes ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    res.status(409).json({ error: "An organization with this slug or Entra tenant ID already exists." });
    return;
  }
  res.status(201).json(row);
});

// PATCH /api/admin/client-orgs/:id
router.patch("/admin/client-orgs/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const parsed = UpdateOrgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  let defaultRoleId: string | null | undefined = undefined;
  if (data.defaultRole !== undefined) {
    if (data.defaultRole === null) {
      defaultRoleId = null;
    } else {
      const role = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, data.defaultRole) });
      if (!role) {
        res.status(400).json({ error: `Unknown role: ${data.defaultRole}` });
        return;
      }
      defaultRoleId = role.id;
    }
  }

  const updatePayload: Partial<typeof clientOrganizationsTable.$inferInsert> = {};
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.slug !== undefined) updatePayload.slug = data.slug;
  if (data.entraTenantId !== undefined) updatePayload.entraTenantId = data.entraTenantId ?? null;
  if (data.entraTenantName !== undefined) updatePayload.entraTenantName = data.entraTenantName ?? null;
  if (data.approvedEmailDomains !== undefined) updatePayload.approvedEmailDomains = data.approvedEmailDomains;
  if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
  if (defaultRoleId !== undefined) updatePayload.defaultRoleId = defaultRoleId;
  if (data.notes !== undefined) updatePayload.notes = data.notes ?? null;

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  // Fetch the org before update so we can detect activation transition.
  const existing = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [updated] = await db
    .update(clientOrganizationsTable)
    .set(updatePayload)
    .where(eq(clientOrganizationsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // When a pending org is activated, backfill the default role for all members
  // and notify them by email (fire-and-forget).
  const beingActivated = !existing.isActive && updated.isActive;
  if (beingActivated) {
    const members = await db.query.usersTable.findMany({
      where: eq(usersTable.clientOrganizationId, id),
    });
    for (const member of members) {
      void applyClientOrgRole(member.id, id);
      if (member.email) {
        void sendOrgApproved({
          to: member.email,
          name: member.displayName,
          orgName: updated.name,
        });
      }
    }
  }

  res.json(updated);
});

// DELETE /api/admin/client-orgs/:id
router.delete("/admin/client-orgs/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const [row] = await db
    .delete(clientOrganizationsTable)
    .where(eq(clientOrganizationsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

// GET /api/admin/client-orgs/:id/members
router.get("/admin/client-orgs/:id/members", requireAdmin, async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const members = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      authProvider: usersTable.authProvider,
      lastSignInAt: usersTable.lastSignInAt,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.clientOrganizationId, id))
    .orderBy(desc(usersTable.createdAt));
  res.json({ items: members });
});

// POST /api/admin/client-orgs/:id/members — assign an existing user to the org.
router.post("/admin/client-orgs/:id/members", requireAdmin, async (req, res): Promise<void> => {
  const orgId = req.params.id ?? "";
  const parsed = AssignUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, orgId),
  });
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ clientOrganizationId: orgId })
    .where(eq(usersTable.id, parsed.data.userId))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Immediately grant the org's default role.
  if (org.defaultRoleId) {
    await db
      .insert(userRoles)
      .values({ userId: parsed.data.userId, roleId: org.defaultRoleId })
      .onConflictDoNothing();
  }
  res.json({ ok: true });
});

// DELETE /api/admin/client-orgs/:id/members/:userId — remove user from org.
router.delete("/admin/client-orgs/:id/members/:userId", requireAdmin, async (req, res): Promise<void> => {
  const userId = req.params.userId ?? "";
  const [updated] = await db
    .update(usersTable)
    .set({ clientOrganizationId: null })
    .where(and(
      eq(usersTable.id, userId),
      eq(usersTable.clientOrganizationId, req.params.id ?? ""),
    ))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(404).json({ error: "User not found in this organization" });
    return;
  }
  res.json({ ok: true });
});

export default router;
