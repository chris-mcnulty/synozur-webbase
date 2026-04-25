import { pgTable, text, uuid, primaryKey, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { clientOrganizationsTable } from "./clientOrganizations";

export const ROLE_NAMES = ["admin", "editor", "author", "contributor", "client"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

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
