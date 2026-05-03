import { Router, type IRouter } from "express";
import { eq, desc, and, sql, count, inArray } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  db,
  clientOrganizationsTable,
  clientOrganizationUsersTable,
  clientOrgInvitationsTable,
  rolesTable,
  usersTable,
  userRoles,
  ROLE_NAMES,
  type RoleName,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { applyClientOrgRole } from "../lib/entra";
import { sendOrgApproved, sendClientOrgInvite } from "../lib/email";
import { audit, buildAuditDiff } from "../lib/audit";
import { createSession, setSessionCookie } from "../lib/sessions";

// Admin CRUD for client organizations. Organizations are the unit of client
// access — any user (Entra SSO or email/password) linked to an active org
// automatically receives the org's defaultRole on every sign-in.
//
// #225 — gating moved from `requireAdmin` (env allow-list / `admin` role) to
// `client_orgs.manage`, granted by default to admin / site_admin /
// account_manager. The route paths are unchanged so existing admin pages
// keep working.

const router: IRouter = Router();

const requireManage = requireCapability("client_orgs.manage");

const RoleNameSchema = z.enum(ROLE_NAMES as readonly [RoleName, ...RoleName[]]);
const MembershipRoleSchema = z.enum(["member", "primary_contact"]);

const CreateOrgBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  entraTenantId: z.string().uuid("Must be a valid GUID").nullish(),
  entraTenantName: z.string().max(255).nullish(),
  approvedEmailDomains: z.array(z.string().max(255)).max(50).optional(),
  isActive: z.boolean().optional(),
  defaultRole: RoleNameSchema.nullish(),
  notes: z.string().max(2000).nullish(),
  // #225
  accountManagerUserId: z.string().uuid().nullish(),
});

const UpdateOrgBody = CreateOrgBody.partial();

// Existing route accepted only `userId`; #225 widens it so the admin can paste
// either a UUID or an email address. Email lookup is case-insensitive.
const AssignUserBody = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    role: MembershipRoleSchema.optional(),
  })
  .refine((v) => v.userId || v.email, { message: "Provide userId or email" });

const InviteBody = z.object({
  email: z.string().email().max(255),
  displayName: z.string().max(255).optional(),
  role: MembershipRoleSchema.optional(),
});

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

// #225 — Account managers must hold one of the eligible staff roles
// (admin / site_admin / account_manager). The UI picker already narrows
// choices via /admin/client-orgs/_lookup/staff, but the API enforces it
// independently so a hand-crafted POST/PATCH cannot bind an unrelated
// user as the account manager.
const ELIGIBLE_AM_ROLES = ["admin", "site_admin", "account_manager"] as const;
async function assertEligibleAccountManager(userId: string): Promise<string | null> {
  const exists = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!exists) return "Unknown account manager user.";
  const rows = await db
    .select({ name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        inArray(rolesTable.name, ["admin", "site_admin", "account_manager"]),
      ),
    );
  if (rows.length === 0) {
    return "Selected user is not an admin, site admin, or account manager.";
  }
  return null;
}

// Snapshot of the columns we audit on the org row (excludes housekeeping).
function orgSnapshot(o: typeof clientOrganizationsTable.$inferSelect) {
  return {
    name: o.name,
    slug: o.slug,
    isActive: o.isActive,
    defaultRoleId: o.defaultRoleId,
    accountManagerUserId: o.accountManagerUserId,
    entraTenantId: o.entraTenantId,
    entraTenantName: o.entraTenantName,
    approvedEmailDomains: o.approvedEmailDomains,
    notes: o.notes,
  };
}

// GET /api/admin/client-orgs — list with enrichment for the new clients page.
router.get("/admin/client-orgs", requireAuth, requireManage, async (_req, res): Promise<void> => {
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
      accountManagerUserId: clientOrganizationsTable.accountManagerUserId,
      createdAt: clientOrganizationsTable.createdAt,
    })
    .from(clientOrganizationsTable)
    .leftJoin(rolesTable, eq(clientOrganizationsTable.defaultRoleId, rolesTable.id))
    .where(sql`${clientOrganizationsTable.deletedAt} IS NULL`)
    .orderBy(desc(clientOrganizationsTable.createdAt));

  // Per-org user count (members + direct clientOrganizationId links).
  const userCountRows = await db
    .select({
      orgId: usersTable.clientOrganizationId,
      n: count(usersTable.id),
    })
    .from(usersTable)
    .groupBy(usersTable.clientOrganizationId);
  const userCountByOrg = new Map(
    userCountRows
      .filter((r): r is { orgId: string; n: number } => !!r.orgId)
      .map((r) => [r.orgId, Number(r.n)]),
  );

  // Resolve account-manager + primary-contact display details in single passes.
  const accountManagerIds = Array.from(
    new Set(rows.map((r) => r.accountManagerUserId).filter((x): x is string => !!x)),
  );
  const amUsers = accountManagerIds.length
    ? await db.query.usersTable.findMany({
        where: (u, { inArray }) => inArray(u.id, accountManagerIds),
      })
    : [];
  const amById = new Map(amUsers.map((u) => [u.id, u]));

  const primaryContacts = await db
    .select({
      orgId: clientOrganizationUsersTable.clientOrganizationId,
      userId: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(clientOrganizationUsersTable)
    .innerJoin(usersTable, eq(clientOrganizationUsersTable.userId, usersTable.id))
    .where(eq(clientOrganizationUsersTable.role, "primary_contact"));
  const primaryByOrg = new Map(primaryContacts.map((p) => [p.orgId, p]));

  res.json({
    items: rows.map((r) => {
      const am = r.accountManagerUserId ? amById.get(r.accountManagerUserId) : undefined;
      const pc = primaryByOrg.get(r.id);
      return {
        ...r,
        userCount: userCountByOrg.get(r.id) ?? 0,
        accountManagerName: am?.displayName ?? null,
        accountManagerEmail: am?.email ?? null,
        primaryContactUserId: pc?.userId ?? null,
        primaryContactName: pc?.displayName ?? null,
        primaryContactEmail: pc?.email ?? null,
      };
    }),
  });
});

// GET /api/admin/client-orgs/_lookup/staff — eligible account managers
// (admins, site_admins, account_managers). Used by the client-org edit page
// to populate the account-manager picker without requiring the broader
// admin/editor roles needed by `/cms/users`. #225
router.get("/admin/client-orgs/_lookup/staff", requireAuth, requireManage, async (_req, res): Promise<void> => {
  const eligibleRoles = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(inArray(rolesTable.name, ["admin", "site_admin", "account_manager"]));
  const roleIds = eligibleRoles.map((r) => r.id);
  if (roleIds.length === 0) {
    res.json({ items: [] });
    return;
  }
  const rows = await db
    .selectDistinct({
      id: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(userRoles)
    .innerJoin(usersTable, eq(userRoles.userId, usersTable.id))
    .where(inArray(userRoles.roleId, roleIds))
    .orderBy(usersTable.displayName);
  res.json({ items: rows });
});

// GET /api/admin/client-orgs/:id — single org with its members joined in.
router.get("/admin/client-orgs/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, id),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!org) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const am = org.accountManagerUserId
    ? await db.query.usersTable.findFirst({
        where: eq(usersTable.id, org.accountManagerUserId),
      })
    : null;
  const defaultRole = org.defaultRoleId
    ? await db.query.rolesTable.findFirst({ where: eq(rolesTable.id, org.defaultRoleId) })
    : null;

  // Members: union of explicit `client_organization_users` rows and the older
  // direct FK on `users.client_organization_id`. Membership rows carry the
  // role chip; users present via the FK only are surfaced as "member".
  const memberRows = await db
    .select({
      membershipId: clientOrganizationUsersTable.id,
      role: clientOrganizationUsersTable.role,
      userId: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      authProvider: usersTable.authProvider,
      lastSignInAt: usersTable.lastSignInAt,
      emailVerified: usersTable.emailVerified,
    })
    .from(clientOrganizationUsersTable)
    .innerJoin(usersTable, eq(clientOrganizationUsersTable.userId, usersTable.id))
    .where(eq(clientOrganizationUsersTable.clientOrganizationId, id))
    .orderBy(desc(clientOrganizationUsersTable.createdAt));

  const knownIds = new Set(memberRows.map((m) => m.userId));
  const fkOnly = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      authProvider: usersTable.authProvider,
      lastSignInAt: usersTable.lastSignInAt,
      emailVerified: usersTable.emailVerified,
    })
    .from(usersTable)
    .where(eq(usersTable.clientOrganizationId, id));
  const orphans = fkOnly
    .filter((u) => !knownIds.has(u.userId))
    .map((u) => ({ membershipId: null, role: "member" as const, ...u }));

  // Pending invites — surfaced so the account team can re-send or revoke.
  const pendingInvites = await db
    .select()
    .from(clientOrgInvitationsTable)
    .where(
      and(
        eq(clientOrgInvitationsTable.clientOrganizationId, id),
        sql`${clientOrgInvitationsTable.usedAt} IS NULL`,
      ),
    )
    .orderBy(desc(clientOrgInvitationsTable.createdAt));

  res.json({
    ...org,
    accountManagerName: am?.displayName ?? null,
    accountManagerEmail: am?.email ?? null,
    defaultRoleName: defaultRole?.name ?? null,
    members: [...memberRows, ...orphans],
    pendingInvitations: pendingInvites.map((p) => ({
      token: p.token,
      email: p.email,
      role: p.role,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt,
    })),
  });
});

// POST /api/admin/client-orgs
router.post("/admin/client-orgs", requireAuth, requireManage, async (req, res): Promise<void> => {
  const parsed = CreateOrgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const {
    name, slug, entraTenantId, entraTenantName, approvedEmailDomains,
    isActive, defaultRole, notes, accountManagerUserId,
  } = parsed.data;

  let defaultRoleId: string | null = null;
  if (defaultRole) {
    const role = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, defaultRole) });
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${defaultRole}` });
      return;
    }
    defaultRoleId = role.id;
  }

  if (accountManagerUserId) {
    const err = await assertEligibleAccountManager(accountManagerUserId);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
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
      accountManagerUserId: accountManagerUserId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    res.status(409).json({ error: "An organization with this slug or Entra tenant ID already exists." });
    return;
  }
  await audit({
    actorId: req.authedUser!.id,
    action: "client_org.create",
    entity: "client_organization",
    entityId: row.id,
    diff: { after: orgSnapshot(row) },
  });
  res.status(201).json(row);
});

// PATCH /api/admin/client-orgs/:id
router.patch("/admin/client-orgs/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
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

  if (data.accountManagerUserId) {
    const err = await assertEligibleAccountManager(data.accountManagerUserId);
    if (err) {
      res.status(400).json({ error: err });
      return;
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
  if (data.accountManagerUserId !== undefined) {
    updatePayload.accountManagerUserId = data.accountManagerUserId ?? null;
  }

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const existing = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, id),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [updated] = await db
    .update(clientOrganizationsTable)
    .set({ ...updatePayload, updatedAt: new Date() })
    .where(eq(clientOrganizationsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

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

  const diff = buildAuditDiff(orgSnapshot(existing), orgSnapshot(updated));
  if (diff) {
    await audit({
      actorId: req.authedUser!.id,
      action: "client_org.update",
      entity: "client_organization",
      entityId: id,
      diff,
    });
  }

  res.json(updated);
});

// DELETE /api/admin/client-orgs/:id — soft-delete (sets deletedAt).
router.delete("/admin/client-orgs/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const existing = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, id),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(clientOrganizationsTable)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(clientOrganizationsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "client_org.delete",
    entity: "client_organization",
    entityId: id,
    diff: { before: orgSnapshot(existing) },
  });
  res.json({ ok: true });
});

// GET /api/admin/client-orgs/:id/members — kept for back-compat.
router.get("/admin/client-orgs/:id/members", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
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

// Shared helper for adding an existing user to an org. Writes both the
// explicit membership row and the legacy `users.clientOrganizationId` FK so
// every downstream consumer (Galaxy auth, Entra reconciliation, list counts)
// agrees on the relationship.
async function addExistingUserToOrg(args: {
  orgId: string;
  userId: string;
  role: "member" | "primary_contact";
  actorId: string;
}): Promise<{ status: number; body: unknown }> {
  const { orgId, userId, role, actorId } = args;
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, orgId),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!org) return { status: 404, body: { error: "Organization not found" } };
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) return { status: 404, body: { error: "User not found" } };

  // Enforce one-org-per-user: remove any membership rows in other orgs so
  // the user does not linger on a prior org's roster (especially as a
  // primary_contact). Audit each removal on the old org for traceability.
  // (#225)
  const priorMemberships = await db
    .select()
    .from(clientOrganizationUsersTable)
    .where(
      and(
        eq(clientOrganizationUsersTable.userId, userId),
        sql`${clientOrganizationUsersTable.clientOrganizationId} <> ${orgId}`,
      ),
    );
  if (priorMemberships.length > 0) {
    await db
      .delete(clientOrganizationUsersTable)
      .where(
        and(
          eq(clientOrganizationUsersTable.userId, userId),
          sql`${clientOrganizationUsersTable.clientOrganizationId} <> ${orgId}`,
        ),
      );
    for (const prev of priorMemberships) {
      await audit({
        actorId,
        action: "client_org.member_remove",
        entity: "client_organization_users",
        entityId: prev.clientOrganizationId,
        diff: {
          before: { userId, email: user.email, role: prev.role },
          after: { userId, email: user.email, clientOrganizationId: orgId },
        },
      });
    }
  }

  if (role === "primary_contact") {
    // Demote any existing primary contact for this org to plain member so
    // there is at most one primary contact per organization. Each demotion
    // is audited individually so the membership change is traceable.
    const existingPrimaries = await db
      .select({
        userId: clientOrganizationUsersTable.userId,
        email: usersTable.email,
      })
      .from(clientOrganizationUsersTable)
      .leftJoin(usersTable, eq(clientOrganizationUsersTable.userId, usersTable.id))
      .where(
        and(
          eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
          eq(clientOrganizationUsersTable.role, "primary_contact"),
        ),
      );
    if (existingPrimaries.length > 0) {
      await db
        .update(clientOrganizationUsersTable)
        .set({ role: "member" })
        .where(
          and(
            eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
            eq(clientOrganizationUsersTable.role, "primary_contact"),
          ),
        );
      for (const p of existingPrimaries) {
        if (p.userId === userId) continue;
        await audit({
          actorId,
          action: "client_org.member_update",
          entity: "client_organization_users",
          entityId: orgId,
          diff: {
            before: { userId: p.userId, email: p.email ?? null, role: "primary_contact" },
            after: { userId: p.userId, email: p.email ?? null, role: "member" },
          },
        });
      }
    }
  }

  await db
    .insert(clientOrganizationUsersTable)
    .values({ userId, clientOrganizationId: orgId, role })
    .onConflictDoUpdate({
      target: [
        clientOrganizationUsersTable.userId,
        clientOrganizationUsersTable.clientOrganizationId,
      ],
      set: { role },
    });

  await db
    .update(usersTable)
    .set({ clientOrganizationId: orgId })
    .where(eq(usersTable.id, userId));

  if (org.defaultRoleId) {
    await db
      .insert(userRoles)
      .values({ userId, roleId: org.defaultRoleId })
      .onConflictDoNothing();
  }

  await audit({
    actorId,
    action: "client_org.member_add",
    entity: "client_organization_users",
    entityId: orgId,
    diff: { after: { userId, email: user.email, role } },
  });

  return { status: 200, body: { ok: true, userId, role } };
}

// POST /api/admin/client-orgs/:id/users — add an existing user (by id or email).
// Kept duplicated at /members for back-compat with the existing organizations
// admin page that posts a UUID under the `userId` field.
async function addUserHandler(req: import("express").Request, res: import("express").Response): Promise<void> {
  const orgId = String(req.params.id ?? "");
  const parsed = AssignUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  let userId = parsed.data.userId;
  if (!userId && parsed.data.email) {
    const u = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, parsed.data.email.toLowerCase()),
    });
    if (!u) {
      res.status(404).json({ error: "No user with that email. Use Invite to send a magic-link email instead." });
      return;
    }
    userId = u.id;
  }
  if (!userId) {
    res.status(400).json({ error: "Provide userId or email" });
    return;
  }
  const result = await addExistingUserToOrg({
    orgId,
    userId,
    role: parsed.data.role ?? "member",
    actorId: req.authedUser!.id,
  });
  res.status(result.status).json(result.body);
}
router.post("/admin/client-orgs/:id/users", requireAuth, requireManage, addUserHandler);
router.post("/admin/client-orgs/:id/members", requireAuth, requireManage, addUserHandler);

// DELETE /api/admin/client-orgs/:id/users/:userId — remove member.
async function removeUserHandler(req: import("express").Request, res: import("express").Response): Promise<void> {
  const orgId = String(req.params.id ?? "");
  const userId = String(req.params.userId ?? "");
  const existingMembership = await db.query.clientOrganizationUsersTable.findFirst({
    where: and(
      eq(clientOrganizationUsersTable.userId, userId),
      eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
    ),
  });
  const userBefore = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

  await db
    .delete(clientOrganizationUsersTable)
    .where(
      and(
        eq(clientOrganizationUsersTable.userId, userId),
        eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
      ),
    );

  // Clear the FK only if it currently points at this org so we don't strip
  // cross-org links if any ever exist.
  if (userBefore?.clientOrganizationId === orgId) {
    await db
      .update(usersTable)
      .set({ clientOrganizationId: null })
      .where(eq(usersTable.id, userId));
  }
  if (!existingMembership && userBefore?.clientOrganizationId !== orgId) {
    res.status(404).json({ error: "User not found in this organization" });
    return;
  }

  // Revoke any unused invitation tokens for this user+org so a removed
  // member cannot reactivate access via an old magic link. (#225)
  const revokedNow = new Date();
  const revoked = await db
    .update(clientOrgInvitationsTable)
    .set({ usedAt: revokedNow })
    .where(
      and(
        eq(clientOrgInvitationsTable.invitedUserId, userId),
        eq(clientOrgInvitationsTable.clientOrganizationId, orgId),
        sql`${clientOrgInvitationsTable.usedAt} IS NULL`,
      ),
    )
    .returning({ token: clientOrgInvitationsTable.token });
  if (revoked.length > 0) {
    await audit({
      actorId: req.authedUser!.id,
      action: "client_org.invite_revoke",
      entity: "client_organization",
      entityId: orgId,
      diff: { after: { userId, revokedTokens: revoked.length } },
    });
  }
  await audit({
    actorId: req.authedUser!.id,
    action: "client_org.member_remove",
    entity: "client_organization_users",
    entityId: orgId,
    diff: {
      before: {
        userId,
        email: userBefore?.email ?? null,
        role: existingMembership?.role ?? "member",
      },
    },
  });
  res.json({ ok: true });
}
router.delete("/admin/client-orgs/:id/users/:userId", requireAuth, requireManage, removeUserHandler);
router.delete("/admin/client-orgs/:id/members/:userId", requireAuth, requireManage, removeUserHandler);

// POST /api/admin/client-orgs/:id/invite — invite a brand-new user by email.
// Creates a placeholder users row (no password) when one does not already
// exist, generates a single-use invitation token, attaches the user to the
// organization, and emails a magic-link to set their password.
router.post("/admin/client-orgs/:id/invite", requireAuth, requireManage, async (req, res): Promise<void> => {
  const orgId = String(req.params.id ?? "");
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, orgId),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  const role = parsed.data.role ?? "member";

  // Find existing user; otherwise create a pending placeholder.
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });
  let createdUser = false;
  let rehomedFromOrgId: string | null = null;
  if (!user) {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        email,
        displayName: parsed.data.displayName ?? null,
        authProvider: "local",
        emailVerified: false,
        clientOrganizationId: orgId,
      })
      .returning();
    if (!inserted) {
      res.status(500).json({ error: "Failed to create pending user" });
      return;
    }
    user = inserted;
    createdUser = true;
  } else if (user.clientOrganizationId !== orgId) {
    // Galaxy access is scoped via users.clientOrganizationId, so an invite
    // must re-home the user to the inviting org. Otherwise an existing
    // user could accept the invite and still see only their previous
    // org's data. Capture the previous link so we can audit it. (#225)
    rehomedFromOrgId = user.clientOrganizationId;
    await db
      .update(usersTable)
      .set({ clientOrganizationId: orgId })
      .where(eq(usersTable.id, user.id));
  }

  // Enforce one-org-per-user on the membership join table: drop any
  // prior memberships in other orgs and audit each removal so the
  // invitee never lingers on a prior org's roster.
  const priorMemberships = await db
    .select()
    .from(clientOrganizationUsersTable)
    .where(
      and(
        eq(clientOrganizationUsersTable.userId, user.id),
        sql`${clientOrganizationUsersTable.clientOrganizationId} <> ${orgId}`,
      ),
    );
  if (priorMemberships.length > 0) {
    await db
      .delete(clientOrganizationUsersTable)
      .where(
        and(
          eq(clientOrganizationUsersTable.userId, user.id),
          sql`${clientOrganizationUsersTable.clientOrganizationId} <> ${orgId}`,
        ),
      );
    for (const prev of priorMemberships) {
      await audit({
        actorId: req.authedUser!.id,
        action: "client_org.member_remove",
        entity: "client_organization_users",
        entityId: prev.clientOrganizationId,
        diff: {
          before: { userId: user.id, email, role: prev.role },
          after: { userId: user.id, email, clientOrganizationId: orgId },
        },
      });
    }
  }

  // Mirror primary_contact uniqueness from addExistingUserToOrg: an org has
  // at most one primary contact, so demote any existing one before issuing
  // a primary_contact invite. Each demotion is audited individually.
  if (role === "primary_contact") {
    const existingPrimaries = await db
      .select({
        userId: clientOrganizationUsersTable.userId,
        email: usersTable.email,
      })
      .from(clientOrganizationUsersTable)
      .leftJoin(usersTable, eq(clientOrganizationUsersTable.userId, usersTable.id))
      .where(
        and(
          eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
          eq(clientOrganizationUsersTable.role, "primary_contact"),
        ),
      );
    if (existingPrimaries.length > 0) {
      await db
        .update(clientOrganizationUsersTable)
        .set({ role: "member" })
        .where(
          and(
            eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
            eq(clientOrganizationUsersTable.role, "primary_contact"),
          ),
        );
      for (const p of existingPrimaries) {
        if (p.userId === user.id) continue;
        await audit({
          actorId: req.authedUser!.id,
          action: "client_org.member_update",
          entity: "client_organization_users",
          entityId: orgId,
          diff: {
            before: { userId: p.userId, email: p.email ?? null, role: "primary_contact" },
            after: { userId: p.userId, email: p.email ?? null, role: "member" },
          },
        });
      }
    }
  }

  // Membership row. Capture before-state so we can emit member_add or
  // member_update appropriately — the invite path mutates membership and
  // every change should land on the audit trail. (#225)
  const membershipBefore = await db.query.clientOrganizationUsersTable.findFirst({
    where: and(
      eq(clientOrganizationUsersTable.userId, user.id),
      eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
    ),
  });
  await db
    .insert(clientOrganizationUsersTable)
    .values({ userId: user.id, clientOrganizationId: orgId, role })
    .onConflictDoUpdate({
      target: [
        clientOrganizationUsersTable.userId,
        clientOrganizationUsersTable.clientOrganizationId,
      ],
      set: { role },
    });
  if (!membershipBefore) {
    await audit({
      actorId: req.authedUser!.id,
      action: "client_org.member_add",
      entity: "client_organization_users",
      entityId: orgId,
      diff: { after: { userId: user.id, email, role } },
    });
  } else if (membershipBefore.role !== role) {
    await audit({
      actorId: req.authedUser!.id,
      action: "client_org.member_update",
      entity: "client_organization_users",
      entityId: orgId,
      diff: {
        before: { userId: user.id, email, role: membershipBefore.role },
        after: { userId: user.id, email, role },
      },
    });
  }

  // Generate token; 7-day expiry.
  const token = generateSecureToken();
  await db.insert(clientOrgInvitationsTable).values({
    token,
    clientOrganizationId: orgId,
    email,
    invitedUserId: user.id,
    invitedByUserId: req.authedUser!.id,
    role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  void sendClientOrgInvite({
    to: email,
    name: user.displayName ?? parsed.data.displayName ?? null,
    orgName: org.name,
    inviterName: req.authedUser?.displayName ?? null,
    token,
  });

  await audit({
    actorId: req.authedUser!.id,
    action: "client_org.invite",
    entity: "client_organization",
    entityId: orgId,
    diff: { after: { email, role, createdUser, userId: user.id, rehomedFromOrgId } },
  });

  res.status(201).json({ ok: true, userId: user.id, email, role });
});

// POST /api/auth/accept-invite — public, consumes an invitation token, sets
// the invitee's password, and signs them in. Mounted on this router so it
// stays in the same file as the invite issuance code.
const AcceptInviteBody = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(8).max(128),
  displayName: z.string().max(255).optional(),
});

router.post("/auth/accept-invite", async (req, res): Promise<void> => {
  const parsed = AcceptInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const row = await db.query.clientOrgInvitationsTable.findFirst({
    where: eq(clientOrgInvitationsTable.token, parsed.data.token),
  });
  if (!row) {
    res.status(400).json({ error: "Invalid or expired invitation link." });
    return;
  }
  if (row.usedAt) {
    res.status(400).json({ error: "This invitation has already been used." });
    return;
  }
  if (row.expiresAt < new Date()) {
    res.status(400).json({ error: "This invitation has expired. Ask your account manager for a new one." });
    return;
  }
  // Re-validate the invitee's org linkage at acceptance time. Galaxy access
  // is scoped via users.clientOrganizationId, so an invitation must always
  // result in the user being attached to the inviting org. If the invite
  // record points at a now-deleted org, fail closed; if the user got
  // re-homed elsewhere between issuance and acceptance, restore the
  // invited org link before establishing a session. (#225)
  const invitedOrg = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, row.clientOrganizationId),
      sql`${clientOrganizationsTable.deletedAt} IS NULL`,
    ),
  });
  if (!invitedOrg) {
    res.status(400).json({ error: "This invitation's organization is no longer available." });
    return;
  }
  const invitedUser = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, row.invitedUserId),
  });
  if (!invitedUser || (invitedUser.email ?? "").toLowerCase() !== row.email.toLowerCase()) {
    res.status(400).json({ error: "Invitation no longer matches an active account." });
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, 12);
  await db
    .update(usersTable)
    .set({
      passwordHash: hash,
      emailVerified: true,
      clientOrganizationId: row.clientOrganizationId,
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
      lastSignInAt: new Date(),
    })
    .where(eq(usersTable.id, row.invitedUserId));
  // Defensive: ensure the membership row exists for the invited org with
  // the invited role even if it was tampered with after issuance.
  await db
    .insert(clientOrganizationUsersTable)
    .values({
      userId: row.invitedUserId,
      clientOrganizationId: row.clientOrganizationId,
      role: row.role,
    })
    .onConflictDoUpdate({
      target: [
        clientOrganizationUsersTable.userId,
        clientOrganizationUsersTable.clientOrganizationId,
      ],
      set: { role: row.role },
    });
  await db
    .update(clientOrgInvitationsTable)
    .set({ usedAt: new Date() })
    .where(eq(clientOrgInvitationsTable.token, parsed.data.token));
  // Apply org default role grant immediately so the new session sees it.
  await applyClientOrgRole(row.invitedUserId, row.clientOrganizationId);

  // Establish a real session so the invitee is signed in on return — the
  // intended invite UX is "set password and you're in", no second sign-in
  // round-trip. (#225)
  const ua = req.headers["user-agent"] ?? null;
  const xff = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(xff) ? xff[0] : xff?.split(",")[0]?.trim()) ?? req.ip ?? null;
  const session = await createSession({
    userId: row.invitedUserId,
    userAgent: typeof ua === "string" ? ua : null,
    ip,
  });
  setSessionCookie(req, res, session.token, session.expiresAt);

  res.json({ ok: true, email: row.email, signedIn: true });
});

export default router;
