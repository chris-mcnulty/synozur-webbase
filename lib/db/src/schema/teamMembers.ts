import { pgTable, text, serial, timestamp, boolean, jsonb, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

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
  speakerBookingUrl: text("speaker_booking_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  manualSort: text("manual_sort").notNull().default(""),
  // Optional link to a Synozur user account. When set, the team member's
  // authored blog posts surface their job title, LinkedIn, and a link back
  // to this profile — but only while active=true. Going inactive severs the
  // link on live pages without touching the user record or their posts.
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
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
