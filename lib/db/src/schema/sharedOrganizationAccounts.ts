import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

/**
 * Credentials are deliberately separate from individual email/password auth.
 * Provisioning must create a shared identity with no email or inherited roles.
 * credentialVersion must be checked against live state for every credential.
 */
export const sharedOrganizationAccountsTable = pgTable("shared_organization_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => clientOrganizationsTable.id, { onDelete: "restrict" }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  disabled: boolean("disabled").notNull().default(true),
  credentialVersion: integer("credential_version").notNull().default(1),
  passwordRotatedAt: timestamp("password_rotated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("shared_organization_accounts_user_key").on(t.userId),
  uniqueIndex("shared_organization_accounts_username_key").on(t.username),
  check("shared_organization_accounts_username_check", sql`${t.username} ~ '^[a-z0-9][a-z0-9._@+-]{2,127}$'`),
  check("shared_organization_accounts_version_check", sql`${t.credentialVersion} > 0`),
]);

export const insertSharedOrganizationAccountSchema = createInsertSchema(sharedOrganizationAccountsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type SharedOrganizationAccount = typeof sharedOrganizationAccountsTable.$inferSelect;
export type InsertSharedOrganizationAccount = typeof sharedOrganizationAccountsTable.$inferInsert;
