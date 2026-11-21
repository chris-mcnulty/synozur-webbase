import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamMembersTable } from "./teamMembers";

export const boardSettingsTable = pgTable("board_settings", {
  id: integer("id").primaryKey().default(1),
  public: boolean("public").notNull().default(false),
});

export const boardProfilesTable = pgTable("board_profiles", {
  id: serial("id").primaryKey(),
  group: text("member_group").notNull(),
  teamMemberId: integer("team_member_id").unique().references(() => teamMembersTable.id, { onDelete: "cascade" }),
  slug: text("slug").unique(),
  name: text("name"),
  jobTitle: text("job_title"),
  shortDescription: text("short_description"),
  longDescription: text("long_description"),
  imageUrl: text("image_url"),
  linkedinUrl: text("linkedin_url"),
  website: text("website"),
  email: text("email"),
  speakerBookingUrl: text("speaker_booking_url"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export const insertBoardProfileSchema = createInsertSchema(boardProfilesTable).omit({ id: true, updatedAt: true });
export type InsertBoardProfile = z.infer<typeof insertBoardProfileSchema>;
export type BoardProfileRecord = typeof boardProfilesTable.$inferSelect;
