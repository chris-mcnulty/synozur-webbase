import { pgTable, text, uuid, primaryKey, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";

export const ROLE_NAMES = ["admin", "editor", "author", "contributor"] as const;
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
