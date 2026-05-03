import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

// #225 — single-use invitation token for adding a brand-new user to a client
// organization. The invite email links to /accept-invite?token=… where the
// invitee picks a password and is signed in. The token row also captures the
// pending user id so we can attach membership the moment the invite is
// accepted, and the inviter id for audit trail context.
export const clientOrgInvitationsTable = pgTable(
  "client_org_invitations",
  {
    token: text("token").primaryKey(),
    clientOrganizationId: uuid("client_organization_id")
      .notNull()
      .references(() => clientOrganizationsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedUserId: uuid("invited_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    role: text("role").notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("client_org_invitations_org_idx").on(t.clientOrganizationId),
    index("client_org_invitations_email_idx").on(t.email),
    index("client_org_invitations_expires_idx").on(t.expiresAt),
  ],
);

export type ClientOrgInvitation = typeof clientOrgInvitationsTable.$inferSelect;
export type InsertClientOrgInvitation =
  typeof clientOrgInvitationsTable.$inferInsert;
