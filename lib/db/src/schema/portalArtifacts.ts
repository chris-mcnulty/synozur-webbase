import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { clientOrganizationsTable } from "./clientOrganizations";
import { usersTable } from "./users";

// Curated portal-side artifacts published by an account manager (or, in
// future, by the owning Synozur application via OAuth) for a specific
// client organization. Powers Galaxy's per-application cockpit surfaces:
// Vega strategy snapshots, Constellation engagement status, Nebula workshop
// outcomes, Orion roadmaps, Orbit GTM kits, Zenith governance posture.
//
// `sourceApp` discriminates which app the artifact came from so the UI can
// pick the correct visual treatment. `artifactKind` is intentionally free
// text — every app has its own taxonomy that we don't want to encode in a
// pg enum the moment we add a new kind.
export const PORTAL_SOURCE_APPS = [
  "vega",
  "nebula",
  "constellation",
  "orion",
  "orbit",
  "zenith",
] as const;
export type PortalSourceApp = (typeof PORTAL_SOURCE_APPS)[number];

export const portalSourceAppEnum = pgEnum(
  "portal_source_app",
  PORTAL_SOURCE_APPS,
);

export const portalArtifactsTable = pgTable(
  "portal_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrganizationId: uuid("client_organization_id")
      .notNull()
      .references(() => clientOrganizationsTable.id, { onDelete: "cascade" }),
    sourceApp: portalSourceAppEnum("source_app").notNull(),
    artifactKind: text("artifact_kind").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    externalUrl: text("external_url"),
    thumbnail: text("thumbnail"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("portal_artifacts_org_app_published_idx").on(
      t.clientOrganizationId,
      t.sourceApp,
      t.publishedAt,
    ),
    index("portal_artifacts_org_idx").on(t.clientOrganizationId),
  ],
);

export type PortalArtifact = typeof portalArtifactsTable.$inferSelect;
export type InsertPortalArtifact = typeof portalArtifactsTable.$inferInsert;
