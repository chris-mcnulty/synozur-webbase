import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diffJson: jsonb("diff_json"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
export type InsertAuditLogEntry = typeof auditLogTable.$inferInsert;
