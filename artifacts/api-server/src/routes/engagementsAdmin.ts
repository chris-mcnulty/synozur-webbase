// Admin CRUD for engagements. An engagement represents a tracked piece of
// client-facing work delivered for a single client organization. Full CRUD
// lives here; SPE path management stays in portalDocumentsAdmin.ts.

import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clientOrganizationsTable,
  engagementsTable,
  usersTable,
  ENGAGEMENT_STATUSES,
} from "@workspace/db";
import { requireAuth, requireCapability } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { enqueueCompanyUpsert, enqueueDealUpsert } from "../lib/hubspotSync";

const router: IRouter = Router();

const requireManage = requireCapability("client_orgs.manage");

const CreateEngagementBody = z.object({
  clientOrganizationId: z.string().uuid(),
  title: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  summary: z.string().max(4000).nullish(),
  startedAt: z.string().datetime().nullish(),
  accountLeadUserId: z.string().uuid().nullish(),
  externalRef: z.string().max(500).nullish(),
  spePath: z.string().max(500).nullish(),
});

const UpdateEngagementBody = CreateEngagementBody.partial().omit({ clientOrganizationId: true });

// GET /api/admin/cms/engagements — list all non-deleted engagements.
router.get("/admin/cms/engagements", requireAuth, requireManage, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: engagementsTable.id,
      clientOrganizationId: engagementsTable.clientOrganizationId,
      title: engagementsTable.title,
      slug: engagementsTable.slug,
      status: engagementsTable.status,
      summary: engagementsTable.summary,
      startedAt: engagementsTable.startedAt,
      accountLeadUserId: engagementsTable.accountLeadUserId,
      externalRef: engagementsTable.externalRef,
      spePath: engagementsTable.spePath,
      hubspotDealId: engagementsTable.hubspotDealId,
      createdAt: engagementsTable.createdAt,
      updatedAt: engagementsTable.updatedAt,
      orgName: clientOrganizationsTable.name,
    })
    .from(engagementsTable)
    .leftJoin(
      clientOrganizationsTable,
      eq(engagementsTable.clientOrganizationId, clientOrganizationsTable.id),
    )
    .where(isNull(engagementsTable.deletedAt))
    .orderBy(desc(engagementsTable.createdAt));
  res.json({ items: rows });
});

// GET /api/admin/cms/engagements/:id — single engagement.
router.get("/admin/cms/engagements/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const row = await db.query.engagementsTable.findFirst({
    where: and(eq(engagementsTable.id, id), isNull(engagementsTable.deletedAt)),
  });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, row.clientOrganizationId),
  });
  const lead = row.accountLeadUserId
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, row.accountLeadUserId) })
    : null;
  res.json({
    ...row,
    orgName: org?.name ?? null,
    orgSlug: org?.slug ?? null,
    orgHubspotCompanyId: org?.hubspotCompanyId ?? null,
    accountLeadName: lead?.displayName ?? null,
    accountLeadEmail: lead?.email ?? null,
  });
});

// POST /api/admin/cms/engagements
router.post("/admin/cms/engagements", requireAuth, requireManage, async (req, res): Promise<void> => {
  const parsed = CreateEngagementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const {
    clientOrganizationId,
    title,
    slug,
    status,
    summary,
    startedAt,
    accountLeadUserId,
    externalRef,
    spePath,
  } = parsed.data;

  const org = await db.query.clientOrganizationsTable.findFirst({
    where: and(
      eq(clientOrganizationsTable.id, clientOrganizationId),
      isNull(clientOrganizationsTable.deletedAt),
    ),
  });
  if (!org) {
    res.status(400).json({ error: "Unknown client organization" });
    return;
  }

  const [row] = await db
    .insert(engagementsTable)
    .values({
      clientOrganizationId,
      title,
      slug,
      status: status ?? "active",
      summary: summary ?? null,
      startedAt: startedAt ? new Date(startedAt) : null,
      accountLeadUserId: accountLeadUserId ?? null,
      externalRef: externalRef ?? null,
      spePath: spePath ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    res.status(409).json({ error: "An engagement with this slug already exists for this organization." });
    return;
  }

  await audit({
    actorId: req.authedUser!.id,
    action: "engagement.create",
    entity: "engagement",
    entityId: row.id,
    diff: {
      after: {
        title: row.title,
        slug: row.slug,
        status: row.status,
        clientOrganizationId: row.clientOrganizationId,
      },
    },
  });

  // Enqueue HubSpot company upsert first (idempotent; ensures company exists
  // before the deal association runs), then the deal upsert.
  void enqueueCompanyUpsert({
    orgId: org.id,
    name: org.name,
    slug: org.slug,
    approvedEmailDomains: org.approvedEmailDomains ?? [],
  });
  void enqueueDealUpsert({
    engagementId: row.id,
    title: row.title,
    status: row.status,
    summary: row.summary,
    startedAt: row.startedAt,
    clientOrganizationId: row.clientOrganizationId,
  });

  res.status(201).json(row);
});

// PATCH /api/admin/cms/engagements/:id
router.patch("/admin/cms/engagements/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const parsed = UpdateEngagementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const existing = await db.query.engagementsTable.findFirst({
    where: and(eq(engagementsTable.id, id), isNull(engagementsTable.deletedAt)),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const updatePayload: Partial<typeof engagementsTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.title !== undefined) updatePayload.title = d.title;
  if (d.slug !== undefined) updatePayload.slug = d.slug;
  if (d.status !== undefined) updatePayload.status = d.status;
  if (d.summary !== undefined) updatePayload.summary = d.summary ?? null;
  if (d.startedAt !== undefined) updatePayload.startedAt = d.startedAt ? new Date(d.startedAt) : null;
  if (d.accountLeadUserId !== undefined) updatePayload.accountLeadUserId = d.accountLeadUserId ?? null;
  if (d.externalRef !== undefined) updatePayload.externalRef = d.externalRef ?? null;
  if (d.spePath !== undefined) updatePayload.spePath = d.spePath ?? null;

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(engagementsTable)
    .set({ ...updatePayload, updatedAt: new Date() })
    .where(eq(engagementsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await audit({
    actorId: req.authedUser!.id,
    action: "engagement.update",
    entity: "engagement",
    entityId: id,
    diff: {
      before: {
        title: existing.title,
        slug: existing.slug,
        status: existing.status,
        summary: existing.summary,
      },
      after: {
        title: updated.title,
        slug: updated.slug,
        status: updated.status,
        summary: updated.summary,
      },
    },
  });

  // Re-sync to HubSpot whenever business-relevant fields change.
  void enqueueDealUpsert({
    engagementId: updated.id,
    title: updated.title,
    status: updated.status,
    summary: updated.summary,
    startedAt: updated.startedAt,
    clientOrganizationId: updated.clientOrganizationId,
  });

  res.json(updated);
});

// DELETE /api/admin/cms/engagements/:id — soft-delete.
router.delete("/admin/cms/engagements/:id", requireAuth, requireManage, async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  const existing = await db.query.engagementsTable.findFirst({
    where: and(eq(engagementsTable.id, id), isNull(engagementsTable.deletedAt)),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(engagementsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(engagementsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "engagement.delete",
    entity: "engagement",
    entityId: id,
    diff: { before: { title: existing.title, status: existing.status } },
  });
  res.json({ ok: true });
});

export default router;
