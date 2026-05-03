import { pgTable, text, uuid, primaryKey, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { clientOrganizationsTable } from "./clientOrganizations";

// #110 — seven audience classes layered alongside the legacy CMS roles.
//
//   Audience classes (new):
//     site_admin      — full admin (alias of legacy `admin`)
//     content_author  — editorial author (broader than legacy `author`)
//     hr              — recruiting / careers (#109)
//     internal        — Synozur staff with read access to non-public surfaces
//     customer        — authenticated client-org user (#135 Galaxy)
//     registered      — self-service signed-in user, no privileged surfaces
//
//   Legacy roles (kept for back-compat with existing requireRole() guards
//   and existing role assignments in production):
//     admin, editor, author, contributor, client
//
// `anonymous` is intentionally NOT a row in this table — it's the implicit
// class for any request without a session. The capability evaluator treats
// it as "no roles", which means only capabilities granted to the anonymous
// pseudo-role apply. The pseudo-role lives in lib/capabilities.ts on the
// server side (see ANONYMOUS_ROLE_NAME).
export const ROLE_NAMES = [
  // Legacy (pre-#110) — keep for back-compat
  "admin",
  "editor",
  "author",
  "contributor",
  "client",
  // #110 — audience classes
  "site_admin",
  "content_author",
  "hr",
  "internal",
  "customer",
  "registered",
  // #225 — account managers can manage their client organizations and
  // invite client users without requiring full admin.
  "account_manager",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

// The implicit "no session" pseudo-role. Not a DB row.
export const ANONYMOUS_ROLE_NAME = "anonymous" as const;

export const rolesTable = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").$type<RoleName>().notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("roles_name_key").on(t.name)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const rolesRelations = relations(rolesTable, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(usersTable, { fields: [userRoles.userId], references: [usersTable.id] }),
  role: one(rolesTable, { fields: [userRoles.roleId], references: [rolesTable.id] }),
}));

export type Role = typeof rolesTable.$inferSelect;
export type InsertRole = typeof rolesTable.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;

// #126: admin-managed mapping from Entra security-group object-ids to CMS
// roles. clientOrganizationId scopes the mapping to a specific client org
// (NULL = Synozur-internal mapping). Unique constraints are partial-index
// based and enforced via migrations.ts rather than schema-level declarations
// so Postgres can handle the NULL-scoped variants correctly.
export const entraGroupRoleMappingsTable = pgTable(
  "entra_group_role_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entraGroupId: text("entra_group_id").notNull(),
    entraGroupName: text("entra_group_name"),
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    // NULL = Synozur-internal group mapping; set = scoped to a client org
    clientOrganizationId: uuid("client_organization_id").references(
      () => clientOrganizationsTable.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entra_group_role_org_idx").on(t.clientOrganizationId)],
);

export type EntraGroupRoleMapping = typeof entraGroupRoleMappingsTable.$inferSelect;
export type InsertEntraGroupRoleMapping = typeof entraGroupRoleMappingsTable.$inferInsert;

// #111 — DB-backed role → capability map.
//
// `capabilities.name` is the canonical key consumed by client + server
// guards (e.g. "content.publish", "users.manage"). `role_capabilities`
// joins these to roles. The static map in lib/capabilities.ts on the
// client is now a fallback only — the server hydrates the effective
// capability set on every /api/auth/me read.
export const capabilitiesTable = pgTable(
  "capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("capabilities_name_key").on(t.name)],
);

export const roleCapabilities = pgTable(
  "role_capabilities",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capabilitiesTable.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.capabilityId] }),
    index("role_capabilities_capability_idx").on(t.capabilityId),
  ],
);

export const capabilitiesRelations = relations(capabilitiesTable, ({ many }) => ({
  roleCapabilities: many(roleCapabilities),
}));

export const roleCapabilitiesRelations = relations(roleCapabilities, ({ one }) => ({
  role: one(rolesTable, { fields: [roleCapabilities.roleId], references: [rolesTable.id] }),
  capability: one(capabilitiesTable, {
    fields: [roleCapabilities.capabilityId],
    references: [capabilitiesTable.id],
  }),
}));

export type CapabilityRow = typeof capabilitiesTable.$inferSelect;
export type InsertCapabilityRow = typeof capabilitiesTable.$inferInsert;
export type RoleCapability = typeof roleCapabilities.$inferSelect;
