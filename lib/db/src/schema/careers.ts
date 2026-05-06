import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { mediaTable } from "./media";

// #223 — Native careers integration. Job postings live alongside the rest
// of the marketing-site artifacts; applications reference users + media so
// résumés and applicant identity reuse the existing object-storage and
// auth surfaces (no parallel admin_users / base64 résumés).

export const JOB_STATUSES = ["draft", "published", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "internship",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const jobPostingsTable = pgTable(
  "job_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    requisitionNumber: text("requisition_number").notNull(),
    title: text("title").notNull(),
    department: text("department").notNull().default(""),
    location: text("location").notNull().default(""),
    employmentType: text("employment_type").$type<JobType>().notNull().default("full_time"),
    status: text("status").$type<JobStatus>().notNull().default("draft"),
    description: text("description").notNull().default(""),
    requirementsParagraphs: jsonb("requirements_paragraphs")
      .$type<string[]>()
      .notNull()
      .default([]),
    descriptionParagraphs: jsonb("description_paragraphs")
      .$type<string[]>()
      .notNull()
      .default([]),
    salaryRange: text("salary_range"),
    hiringManagerEmail: text("hiring_manager_email"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("job_postings_slug_key").on(t.slug),
    uniqueIndex("job_postings_req_number_key").on(t.requisitionNumber),
    index("job_postings_status_idx").on(t.status),
  ],
);

export type JobPosting = typeof jobPostingsTable.$inferSelect;
export type InsertJobPosting = typeof jobPostingsTable.$inferInsert;

export const APPLICATION_STATUSES = [
  "new",
  "reviewing",
  "interview",
  "offer",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const jobApplicationsTable = pgTable(
  "job_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null jobPostingId = general / talent-network application.
    jobPostingId: uuid("job_posting_id").references(() => jobPostingsTable.id, {
      onDelete: "set null",
    }),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    education: text("education"),
    experience: text("experience"),
    coverLetter: text("cover_letter"),
    workAuthorized: boolean("work_authorized"),
    requireSponsorship: boolean("require_sponsorship"),
    // Voluntary EEO demographics — null = "decline to answer".
    eeoRace: text("eeo_race"),
    eeoGender: text("eeo_gender"),
    eeoVeteran: text("eeo_veteran"),
    eeoDisability: text("eeo_disability"),
    gdprConsent: boolean("gdpr_consent").notNull().default(false),
    resumeMediaId: uuid("resume_media_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<ApplicationStatus>().notNull().default("new"),
    aiMatchScore: integer("ai_match_score"),
    aiMatchReasoning: text("ai_match_reasoning"),
    aiScoredAt: timestamp("ai_scored_at", { withTimezone: true }),
    recruiterRating: integer("recruiter_rating"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("job_applications_job_idx").on(t.jobPostingId),
    index("job_applications_applicant_idx").on(t.applicantUserId),
    index("job_applications_status_idx").on(t.status),
    index("job_applications_submitted_idx").on(t.submittedAt),
  ],
);

export type JobApplication = typeof jobApplicationsTable.$inferSelect;
export type InsertJobApplication = typeof jobApplicationsTable.$inferInsert;

export const jobApplicationNotesTable = pgTable(
  "job_application_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => jobApplicationsTable.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("job_application_notes_app_idx").on(t.applicationId)],
);

export type JobApplicationNote = typeof jobApplicationNotesTable.$inferSelect;
export type InsertJobApplicationNote =
  typeof jobApplicationNotesTable.$inferInsert;
