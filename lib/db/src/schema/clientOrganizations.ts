import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { rolesTable } from "./roles";

// A client organization is any external entity (company, partner, individual
// account holder) whose members are allowed portal access. It decouples
// "who may log in" from "which Azure AD tenant they use" so that:
//   - Entra SSO users map via entraTenantId
//   - Email/password registrants are manually or invite-linked to an org
//   - Domain-based auto-join works via approvedEmailDomains
//
// The defaultRoleId is the role automatically granted to every member of this
// org on sign-in (typically a "client" role). NULL means no automatic grant.
export const clientOrganizationsTable = pgTable(
  "client_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Entra SSO: if set, users whose ID-token tid matches this value are
    // automatically associated with this org. Must be globally unique.
    entraTenantId: text("entra_tenant_id"),
    entraTenantName: text("entra_tenant_name"),
    // Domain-based auto-join for email/password users. Comma-separated or
    // stored as an array in the DB (migration uses text[]).
    approvedEmailDomains: text("approved_email_domains").array(),
    // When false, sign-ins from this org are rejected with 403.
    isActive: boolean("is_active").notNull().default(true),
    // Role automatically granted to org members on each sign-in.
    defaultRoleId: uuid("default_role_id").references(() => rolesTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    // Set to true when this org was created automatically during an unknown
    // Entra tenant's first sign-in. Used to distinguish "pending approval"
    // (autoCreated + !isActive) from "deliberately deactivated" (!isActive).
    autoCreated: boolean("auto_created").notNull().default(false),
    // Internal account manager who owns the client relationship. Surfaced on
    // the customer portal "your account team" card. The FK is declared in
    // the startup migration (not via Drizzle's `.references()`) to avoid the
    // circular import between users ↔ clientOrganizations.
    accountManagerUserId: uuid("account_manager_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete marker. Active orgs have NULL; deleted orgs are filtered
    // out of the portal but the row is preserved for engagement history.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("client_orgs_slug_key").on(t.slug)],
);

export type ClientOrganization =
  typeof clientOrganizationsTable.$inferSelect;
export type InsertClientOrganization =
  typeof clientOrganizationsTable.$inferInsert;
