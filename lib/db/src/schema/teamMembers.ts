import { pgTable, text, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  jobTitle: text("job_title").notNull().default(""),
  shortDescription: text("short_description"),
  longDescription: text("long_description"),
  imageUrl: text("image_url"),
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  manualSort: text("manual_sort").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
