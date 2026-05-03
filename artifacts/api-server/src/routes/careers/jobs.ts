import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  jobPostingsTable,
  JOB_STATUSES,
  JOB_TYPES,
  type JobPosting,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import { audit } from "../../lib/audit";
import { toSlug } from "../../lib/slug";

const router: IRouter = Router();

const writeGuard = [requireAuth, requireCapability("careers.jobs.write")];
const readGuard = [requireAuth, requireCapability("careers.jobs.read")];

function serialize(j: JobPosting) {
  return {
    id: j.id,
    slug: j.slug,
    requisitionNumber: j.requisitionNumber,
    title: j.title,
    department: j.department,
    location: j.location,
    employmentType: j.employmentType,
    status: j.status,
    description: j.description,
    descriptionParagraphs: j.descriptionParagraphs ?? [],
    requirementsParagraphs: j.requirementsParagraphs ?? [],
    salaryRange: j.salaryRange,
    hiringManagerEmail: j.hiringManagerEmail,
    publishedAt: j.publishedAt ? j.publishedAt.toISOString() : null,
    closedAt: j.closedAt ? j.closedAt.toISOString() : null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = toSlug(base) || "job";
  let i = 1;
  while (true) {
    const found = await db.query.jobPostingsTable.findFirst({
      where: excludeId
        ? and(eq(jobPostingsTable.slug, slug), ne(jobPostingsTable.id, excludeId))
        : eq(jobPostingsTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

async function nextRequisitionNumber(): Promise<string> {
  // Format: REQ-XXXX with 4-digit zero-padded sequence; auto-increments based
  // on the max numeric tail across existing rows. Editable by the admin once
  // the row is created — uniqueness is enforced at the DB level.
  const rows = await db
    .select({ rn: jobPostingsTable.requisitionNumber })
    .from(jobPostingsTable);
  let max = 0;
  for (const r of rows) {
    const m = /REQ-(\d+)/i.exec(r.rn);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `REQ-${String(max + 1).padStart(4, "0")}`;
}

// ---- Public ----------------------------------------------------------------

router.get("/careers/jobs", async (_req, res) => {
  const rows = await db
    .select()
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.status, "published"))
    .orderBy(desc(jobPostingsTable.publishedAt), asc(jobPostingsTable.title));
  res.json({ items: rows.map(serialize) });
});

router.get("/careers/jobs/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const row = await db.query.jobPostingsTable.findFirst({
    where: and(
      eq(jobPostingsTable.slug, slug),
      eq(jobPostingsTable.status, "published"),
    ),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

// ---- Admin -----------------------------------------------------------------

const JobBody = z.object({
  slug: z.string().nullish(),
  requisitionNumber: z.string().min(1).max(40).nullish(),
  title: z.string().min(1).max(200),
  department: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  employmentType: z.enum(JOB_TYPES).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  description: z.string().max(20000).optional(),
  descriptionParagraphs: z.array(z.string()).optional(),
  requirementsParagraphs: z.array(z.string()).optional(),
  salaryRange: z.string().max(120).nullish(),
  hiringManagerEmail: z.string().email().nullish(),
});
const JobPatch = JobBody.partial();

router.get("/cms/careers/jobs", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(jobPostingsTable)
    .orderBy(desc(jobPostingsTable.updatedAt));
  res.json({ items: rows.map(serialize) });
});

router.get("/cms/careers/jobs/:id", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const row = await db.query.jobPostingsTable.findFirst({
    where: eq(jobPostingsTable.id, id),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.post("/cms/careers/jobs", ...writeGuard, async (req, res) => {
  const parsed = JobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const slug = await ensureUniqueSlug(d.slug || d.title);
  const rn = d.requisitionNumber?.trim() || (await nextRequisitionNumber());
  const status = d.status ?? "draft";
  const [row] = await db
    .insert(jobPostingsTable)
    .values({
      slug,
      requisitionNumber: rn,
      title: d.title,
      department: d.department ?? "",
      location: d.location ?? "",
      employmentType: d.employmentType ?? "full_time",
      status,
      description: d.description ?? "",
      descriptionParagraphs: d.descriptionParagraphs ?? [],
      requirementsParagraphs: d.requirementsParagraphs ?? [],
      salaryRange: d.salaryRange ?? null,
      hiringManagerEmail: d.hiringManagerEmail ?? null,
      publishedAt: status === "published" ? new Date() : null,
      closedAt: status === "closed" ? new Date() : null,
      createdBy: req.authedUser?.id ?? null,
    })
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "careers.job.create",
    entity: "job_posting",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/careers/jobs/:id", ...writeGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.jobPostingsTable.findFirst({
    where: eq(jobPostingsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = JobPatch.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof jobPostingsTable.$inferInsert> = {};
  if (d.slug) updates.slug = await ensureUniqueSlug(d.slug, id);
  if (d.requisitionNumber !== undefined && d.requisitionNumber !== null) {
    updates.requisitionNumber = d.requisitionNumber;
  }
  if (d.title !== undefined) updates.title = d.title;
  if (d.department !== undefined) updates.department = d.department;
  if (d.location !== undefined) updates.location = d.location;
  if (d.employmentType !== undefined) updates.employmentType = d.employmentType;
  if (d.description !== undefined) updates.description = d.description;
  if (d.descriptionParagraphs !== undefined)
    updates.descriptionParagraphs = d.descriptionParagraphs;
  if (d.requirementsParagraphs !== undefined)
    updates.requirementsParagraphs = d.requirementsParagraphs;
  if (d.salaryRange !== undefined) updates.salaryRange = d.salaryRange ?? null;
  if (d.hiringManagerEmail !== undefined)
    updates.hiringManagerEmail = d.hiringManagerEmail ?? null;
  if (d.status !== undefined) {
    updates.status = d.status;
    if (d.status === "published" && !existing.publishedAt) {
      updates.publishedAt = new Date();
    }
    if (d.status === "closed") updates.closedAt = new Date();
  }
  const [row] = await db
    .update(jobPostingsTable)
    .set(updates)
    .where(eq(jobPostingsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "careers.job.update",
    entity: "job_posting",
    entityId: id,
    diff: { before: existing, after: row },
  });
  res.json(serialize(row));
});

router.delete("/cms/careers/jobs/:id", ...writeGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.jobPostingsTable.findFirst({
    where: eq(jobPostingsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(jobPostingsTable).where(eq(jobPostingsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "careers.job.delete",
    entity: "job_posting",
    entityId: id,
  });
  res.status(204).end();
});

// Internal helper used by next-requisition admin UI button.
router.get("/cms/careers/next-requisition", ...readGuard, async (_req, res) => {
  res.json({ requisitionNumber: await nextRequisitionNumber() });
});

// Suppress unused-warning for sql import (kept for future filters).
void sql;

export default router;
