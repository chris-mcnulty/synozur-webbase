import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, timestamp, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

/**
 * Independent of engagement artifacts: no engagement/contract is required.
 * Unassigned imports are drafts until staff explicitly select an organization.
 */
export const privateCustomerPagesTable = pgTable("private_customer_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => clientOrganizationsTable.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  reviewedRevision: integer("reviewed_revision"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("private_customer_pages_org_slug_key").on(t.organizationId, t.slug),
  index("private_customer_pages_org_status_idx").on(t.organizationId, t.status),
  check("private_customer_pages_status_check", sql`${t.status} IN ('draft', 'published', 'archived')`),
  check("private_customer_pages_revision_check", sql`${t.revision} > 0`),
  check("private_customer_pages_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("private_customer_pages_publication_check", sql`
    ${t.status} <> 'published' OR (
      ${t.organizationId} IS NOT NULL AND ${t.publishedAt} IS NOT NULL
      AND ${t.reviewedRevision} IS NOT NULL AND ${t.reviewedRevision} = ${t.revision}
      AND ${t.reviewedAt} IS NOT NULL
    )
  `),
]);

export const insertPrivateCustomerPageSchema = createInsertSchema(privateCustomerPagesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type PrivateCustomerPage = typeof privateCustomerPagesTable.$inferSelect;
export type InsertPrivateCustomerPage = typeof privateCustomerPagesTable.$inferInsert;
