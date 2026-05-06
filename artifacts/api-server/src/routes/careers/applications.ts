import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  jobApplicationsTable,
  jobApplicationNotesTable,
  jobPostingsTable,
  mediaTable,
  siteSettingsTable,
  usersTable,
  APPLICATION_STATUSES,
  type JobApplication,
  type JobApplicationNote,
} from "@workspace/db";
import {
  requireAuth,
  requireCapability,
} from "../../middlewares/auth";
import { ObjectStorageService } from "../../lib/objectStorage";
import { audit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import {
  scheduleApplicationScoring,
  runScoring,
} from "../../lib/careersAi";
import {
  extractTextFromBuffer,
  parseResumeText,
} from "../../lib/careersResumeParser";
import {
  sendApplicantConfirmation,
  sendHiringManagerNotification,
} from "../../lib/careersEmail";

const router: IRouter = Router();

const objectStorage = new ObjectStorageService();

const readGuard = [requireAuth, requireCapability("careers.applications.read")];
const writeGuard = [
  requireAuth,
  requireCapability("careers.applications.write"),
];

function serialize(a: JobApplication) {
  return {
    id: a.id,
    jobPostingId: a.jobPostingId,
    applicantUserId: a.applicantUserId,
    fullName: a.fullName,
    email: a.email,
    phone: a.phone,
    linkedinUrl: a.linkedinUrl,
    education: a.education,
    experience: a.experience,
    coverLetter: a.coverLetter,
    workAuthorized: a.workAuthorized,
    requireSponsorship: a.requireSponsorship,
    eeoRace: a.eeoRace,
    eeoGender: a.eeoGender,
    eeoVeteran: a.eeoVeteran,
    eeoDisability: a.eeoDisability,
    gdprConsent: a.gdprConsent,
    resumeMediaId: a.resumeMediaId,
    status: a.status,
    aiMatchScore: a.aiMatchScore,
    aiMatchReasoning: a.aiMatchReasoning,
    aiScoredAt: a.aiScoredAt ? a.aiScoredAt.toISOString() : null,
    recruiterRating: a.recruiterRating,
    submittedAt: a.submittedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeNote(n: JobApplicationNote) {
  return {
    id: n.id,
    applicationId: n.applicationId,
    authorId: n.authorId,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  };
}

const SubmitBody = z.object({
  jobSlug: z.string().nullish(),
  fullName: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(60).nullish(),
  linkedinUrl: z.string().url().max(500).nullish().or(z.literal("")),
  education: z.string().max(4000).nullish(),
  experience: z.string().max(20000).nullish(),
  coverLetter: z.string().max(20000).nullish(),
  workAuthorized: z.boolean().nullish(),
  requireSponsorship: z.boolean().nullish(),
  eeoRace: z.string().max(120).nullish(),
  eeoGender: z.string().max(120).nullish(),
  eeoVeteran: z.string().max(120).nullish(),
  eeoDisability: z.string().max(120).nullish(),
  gdprConsent: z.boolean(),
  resumeMediaId: z.string().uuid().nullish(),
});

// ---- AI résumé parse (Gap 1) ---------------------------------------------
//
// Takes a previously-uploaded mediaId, downloads the file from object storage,
// extracts text, and asks Anthropic to return structured candidate data.

const ParseResumeBody = z.object({
  mediaId: z.string().uuid(),
});

router.post("/careers/resume-parse", requireAuth, async (req, res) => {
  const parsed = ParseResumeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const media = await db.query.mediaTable.findFirst({
    where: eq(mediaTable.id, parsed.data.mediaId),
  });
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  try {
    const ref = await objectStorage.getObjectEntityFile(media.storageKey);
    const dlRes = await objectStorage.downloadObject(ref);
    const arrayBuf = await dlRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const text = await extractTextFromBuffer(buf, media.mime, media.originalName);
    const result = await parseResumeText(text);
    res.json(result);
  } catch (err) {
    logger.warn({ err, mediaId: parsed.data.mediaId }, "careers resume-parse failed");
    res.status(500).json({ error: "Failed to parse résumé" });
  }
});

// ---- Applicant résumé upload ---------------------------------------------
//
// Two-step: (1) request an upload URL, (2) PUT bytes there, (3) register
// the media row. The two-step ceremony is wrapped here in a single
// helper endpoint so applicant accounts (no CMS role) can attach a
// résumé without exposing /cms/media writes to the public.

router.post("/careers/resume-upload-url", requireAuth, async (req, res) => {
  const contentType =
    typeof req.body?.contentType === "string"
      ? req.body.contentType
      : "application/pdf";
  if (
    contentType !== "application/pdf" &&
    contentType !== "application/msword" &&
    contentType !==
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    res.status(415).json({ error: "Résumés must be PDF or Word documents" });
    return;
  }
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    res.json({ uploadURL });
  } catch (err) {
    logger.error({ err }, "careers resume upload url failed");
    res.status(500).json({ error: "Could not generate upload URL" });
  }
});

const RegisterResumeBody = z.object({
  storageKey: z.string().min(1),
  mime: z.string().min(1).max(120),
  byteSize: z.number().int().nonnegative().nullish(),
  originalName: z.string().min(1).max(300),
});

router.post("/careers/resume-register", requireAuth, async (req, res) => {
  const parsed = RegisterResumeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(mediaTable)
    .values({
      storageKey: d.storageKey,
      publicUrl: "",
      mime: d.mime,
      altText: d.originalName,
      originalName: d.originalName,
      byteSize: d.byteSize ?? null,
      uploadedBy: req.authedUser!.id,
    })
    .returning();
  res.status(201).json({ id: row.id, originalName: row.originalName });
});

// ---- Applicant submit (auth required) -------------------------------------

router.post("/careers/applications", requireAuth, async (req, res) => {
  const parsed = SubmitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!d.gdprConsent) {
    res.status(400).json({ error: "GDPR consent is required" });
    return;
  }
  let job = null;
  if (d.jobSlug) {
    job = await db.query.jobPostingsTable.findFirst({
      where: and(
        eq(jobPostingsTable.slug, d.jobSlug),
        eq(jobPostingsTable.status, "published"),
      ),
    });
    if (!job) {
      res.status(404).json({ error: "Job posting not found or closed" });
      return;
    }
  }
  if (d.resumeMediaId) {
    const m = await db.query.mediaTable.findFirst({
      where: eq(mediaTable.id, d.resumeMediaId),
    });
    if (!m) {
      res.status(400).json({ error: "Unknown resumeMediaId" });
      return;
    }
  }
  const [row] = await db
    .insert(jobApplicationsTable)
    .values({
      jobPostingId: job?.id ?? null,
      applicantUserId: req.authedUser!.id,
      fullName: d.fullName,
      email: d.email,
      phone: d.phone ?? null,
      linkedinUrl: d.linkedinUrl || null,
      education: d.education ?? null,
      experience: d.experience ?? null,
      coverLetter: d.coverLetter ?? null,
      workAuthorized: d.workAuthorized ?? null,
      requireSponsorship: d.requireSponsorship ?? null,
      eeoRace: d.eeoRace ?? null,
      eeoGender: d.eeoGender ?? null,
      eeoVeteran: d.eeoVeteran ?? null,
      eeoDisability: d.eeoDisability ?? null,
      gdprConsent: d.gdprConsent,
      resumeMediaId: d.resumeMediaId ?? null,
    })
    .returning();

  // Confirmation + hiring manager notification (fire-and-forget).
  void sendApplicantConfirmation({
    to: d.email,
    applicantName: d.fullName,
    jobTitle: job?.title ?? null,
  });

  // Hiring manager email — explicit on the job, falls back to site setting.
  let hmEmail = job?.hiringManagerEmail ?? null;
  if (!hmEmail) {
    const [s] = await db
      .select({ to: siteSettingsTable.careersDefaultHiringManager })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1));
    hmEmail = s?.to ?? null;
  }
  if (hmEmail) {
    void sendHiringManagerNotification({
      to: hmEmail,
      applicantName: d.fullName,
      jobTitle: job?.title ?? "General application",
      applicationId: row.id,
    });
  }

  // AI scoring runs in the background; the row updates when it lands.
  scheduleApplicationScoring(row.id);

  res.status(201).json({ id: row.id, status: row.status });
});

// ---- Self-service: list my applications -----------------------------------

router.get("/careers/my-applications", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(jobApplicationsTable)
    .where(eq(jobApplicationsTable.applicantUserId, req.authedUser!.id))
    .orderBy(desc(jobApplicationsTable.submittedAt));
  res.json({ items: rows.map(serialize) });
});

// ---- Admin / HR -----------------------------------------------------------

router.get("/cms/careers/applications", ...readGuard, async (req, res) => {
  const status = req.query.status as string | undefined;
  const jobId = req.query.jobId as string | undefined;
  const where = and(
    status && APPLICATION_STATUSES.includes(status as never)
      ? eq(jobApplicationsTable.status, status as never)
      : undefined,
    jobId ? eq(jobApplicationsTable.jobPostingId, jobId) : undefined,
  );
  const rows = await db
    .select()
    .from(jobApplicationsTable)
    .where(where)
    .orderBy(desc(jobApplicationsTable.submittedAt));
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/careers/applications/export.csv", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(jobApplicationsTable)
    .orderBy(desc(jobApplicationsTable.submittedAt));
  const headers = [
    "id",
    "submittedAt",
    "status",
    "fullName",
    "email",
    "phone",
    "linkedinUrl",
    "jobPostingId",
    "aiMatchScore",
    "eeoRace",
    "eeoGender",
    "eeoVeteran",
    "eeoDisability",
  ];
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.submittedAt.toISOString(),
        r.status,
        r.fullName,
        r.email,
        r.phone ?? "",
        r.linkedinUrl ?? "",
        r.jobPostingId ?? "",
        r.aiMatchScore ?? "",
        r.eeoRace ?? "",
        r.eeoGender ?? "",
        r.eeoVeteran ?? "",
        r.eeoDisability ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="careers-applications-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(lines.join("\n"));
});

router.get("/cms/careers/applications/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.jobApplicationsTable.findFirst({
    where: eq(jobApplicationsTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Pull in the linked job + applicant user + media (résumé) for the detail view.
  const [job, applicant, media, notes] = await Promise.all([
    row.jobPostingId
      ? db.query.jobPostingsTable.findFirst({
          where: eq(jobPostingsTable.id, row.jobPostingId),
        })
      : Promise.resolve(null),
    db.query.usersTable.findFirst({
      where: eq(usersTable.id, row.applicantUserId),
    }),
    row.resumeMediaId
      ? db.query.mediaTable.findFirst({
          where: eq(mediaTable.id, row.resumeMediaId),
        })
      : Promise.resolve(null),
    db
      .select()
      .from(jobApplicationNotesTable)
      .where(eq(jobApplicationNotesTable.applicationId, id))
      .orderBy(asc(jobApplicationNotesTable.createdAt)),
  ]);
  res.json({
    application: serialize(row),
    job: job
      ? { id: job.id, slug: job.slug, title: job.title, requisitionNumber: job.requisitionNumber }
      : null,
    applicant: applicant
      ? { id: applicant.id, email: applicant.email, displayName: applicant.displayName }
      : null,
    resume: media
      ? { id: media.id, publicUrl: media.publicUrl, originalName: media.originalName }
      : null,
    notes: notes.map(serializeNote),
  });
});

const PatchBody = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  recruiterRating: z.number().int().min(0).max(100).nullable().optional(),
});

router.patch("/cms/careers/applications/:id", ...writeGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.jobApplicationsTable.findFirst({
    where: eq(jobApplicationsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof jobApplicationsTable.$inferInsert> = {};
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.recruiterRating !== undefined) updates.recruiterRating = parsed.data.recruiterRating;
  const [row] = await db
    .update(jobApplicationsTable)
    .set(updates)
    .where(eq(jobApplicationsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "careers.application.update",
    entity: "job_application",
    entityId: id,
    diff: { before: { status: existing.status }, after: { status: row.status } },
  });
  res.json(serialize(row));
});

const NoteBody = z.object({ body: z.string().min(1).max(8000) });

router.post(
  "/cms/careers/applications/:id/notes",
  ...writeGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await db.query.jobApplicationsTable.findFirst({
      where: eq(jobApplicationsTable.id, id),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = NoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const [row] = await db
      .insert(jobApplicationNotesTable)
      .values({
        applicationId: id,
        authorId: req.authedUser!.id,
        body: parsed.data.body,
      })
      .returning();
    await audit({
      actorId: req.authedUser!.id,
      action: "careers.application.note.create",
      entity: "job_application",
      entityId: id,
    });
    res.status(201).json(serializeNote(row));
  },
);

router.post(
  "/cms/careers/applications/:id/rescore",
  ...writeGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const result = await runScoring(id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await audit({
      actorId: req.authedUser!.id,
      action: "careers.application.rescore",
      entity: "job_application",
      entityId: id,
      diff: { score: result.score },
    });
    res.json(result);
  },
);

// EEO summary for the applications dashboard.
router.get(
  "/cms/careers/applications/eeo-summary",
  requireAuth,
  requireCapability("careers.eeo.read"),
  async (_req, res) => {
    try {
      const rows = await db
        .select({
          eeoRace: jobApplicationsTable.eeoRace,
          eeoGender: jobApplicationsTable.eeoGender,
          eeoVeteran: jobApplicationsTable.eeoVeteran,
        })
        .from(jobApplicationsTable);
      const tally = (key: keyof (typeof rows)[number]) => {
        const map: Record<string, number> = {};
        for (const r of rows) {
          const v = (r[key] ?? "Decline to answer") as string;
          map[v] = (map[v] ?? 0) + 1;
        }
        return map;
      };
      res.json({
        total: rows.length,
        race: tally("eeoRace"),
        gender: tally("eeoGender"),
        veteran: tally("eeoVeteran"),
      });
    } catch (err) {
      logger.warn({ err }, "careers eeo summary failed");
      res.status(500).json({ error: "Failed to summarize EEO data" });
    }
  },
);

export default router;
