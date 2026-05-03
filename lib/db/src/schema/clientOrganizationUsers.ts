import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

// Explicit membership join between users and client organizations. The
// `users.client_organization_id` direct FK still drives the auth-time role
// grant, but the portal needs a richer relationship — multiple contacts per
// org, primary-contact distinction, audit trail on add/remove — so we keep a
// dedicated row here.
export const clientOrganizationUsersTable = pgTable(
  "client_organization_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientOrganizationId: uuid("client_organization_id")
      .notNull()
      .references(() => clientOrganizationsTable.id, { onDelete: "cascade" }),
    // 'member' = ordinary portal user; 'primary_contact' = surfaced first on
    // the account team card and used as the default recipient for status
    // notifications.
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_org_users_unique").on(t.userId, t.clientOrganizationId),
    index("client_org_users_org_idx").on(t.clientOrganizationId),
    index("client_org_users_user_idx").on(t.userId),
  ],
);

export type ClientOrganizationUser =
  typeof clientOrganizationUsersTable.$inferSelect;
export type InsertClientOrganizationUser =
  typeof clientOrganizationUsersTable.$inferInsert;

export const CLIENT_ORG_USER_ROLES = ["member", "primary_contact"] as const;
export type ClientOrgUserRole = (typeof CLIENT_ORG_USER_ROLES)[number];
