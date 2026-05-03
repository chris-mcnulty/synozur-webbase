import {
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

// Engagement = a tracked client-facing piece of work delivered for a single
// client organization. v0 of the Galaxy customer portal uses this table to
// render the "Active engagements" list on the portal home; later phases will
// add deliverable browsing, status change feeds, and account-team threads
// keyed off the same row.
export const engagementsTable = pgTable(
  "engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrganizationId: uuid("client_organization_id")
      .notNull()
      .references(() => clientOrganizationsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    // Free-form lifecycle marker. Allowed values today: 'active' | 'paused'
    // | 'completed' | 'archived'. Stored as text rather than a pg enum so
    // adding values doesn't require a migration on every Postgres restart.
    status: text("status").notNull().default("active"),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    // Account lead surfaced as the engagement owner on the portal home. May
    // differ from the org-level account manager (e.g. a delivery lead for
    // this particular workstream).
    accountLeadUserId: uuid("account_lead_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Optional reference into an external system of record (Notion page,
    // SharePoint URL, Jira project key, etc.). Not validated here; the
    // calling surface is responsible for shape.
    externalRef: text("external_ref"),
    // Folder path inside the active SPE container that this engagement's
    // deliverables live in (e.g. `/engagements/acme-roadmap`). The
    // portal-document indexer walks this path; null means deliverables
    // haven't been wired up yet. Stored as text so admins can correct
    // typos without a migration.
    spePath: text("spe_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("engagements_org_slug_key").on(
      t.clientOrganizationId,
      t.slug,
    ),
    index("engagements_org_idx").on(t.clientOrganizationId),
    index("engagements_status_idx").on(t.status),
  ],
);

export type Engagement = typeof engagementsTable.$inferSelect;
export type InsertEngagement = typeof engagementsTable.$inferInsert;

export const ENGAGEMENT_STATUSES = [
  "active",
  "paused",
  "completed",
  "archived",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
