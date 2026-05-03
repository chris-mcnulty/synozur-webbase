// #227 — Admin surface for portal-document indexing and publish toggles.
//
// Account managers use these endpoints to (1) walk an engagement's SPE
// folder and upsert rows into `portal_documents`, and (2) flip individual
// documents between published / unpublished. Both actions emit audit log
// entries so we can reconstruct who exposed what to which client.

import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clientOrganizationsTable,
  engagementsTable,
  portalDocumentsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { audit } from "../lib/audit";
import { indexEngagementDocuments } from "../lib/portalDocumentIndexer";

const router: IRouter = Router();

// GET /api/admin/engagements — flat list for the documents admin UI's
// engagement picker. Cheap and unpaginated; we expect O(100) rows tops.
router.get("/admin/engagements", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: engagementsTable.id,
      title: engagementsTable.title,
      slug: engagementsTable.slug,
      status: engagementsTable.status,
      spePath: engagementsTable.spePath,
      orgId: clientOrganizationsTable.id,
      orgName: clientOrganizationsTable.name,
    })
    .from(engagementsTable)
    .leftJoin(
      clientOrganizationsTable,
      eq(engagementsTable.clientOrganizationId, clientOrganizationsTable.id),
    )
    .where(isNull(engagementsTable.deletedAt))
    .orderBy(asc(engagementsTable.title));
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      spePath: r.spePath,
      organization: r.orgId
        ? { id: r.orgId, name: r.orgName }
        : null,
    })),
  });
});

const UpdateEngagementSpePathBody = z.object({
  spePath: z.string().min(1).max(500).nullable(),
});

// PATCH /api/admin/engagements/:id — admin-only; today only spePath is
// editable. Created as a small surface area rather than reusing the
// (still TBD) full engagement admin so this task can ship independently.
router.patch(
  "/admin/engagements/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateEngagementSpePathBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const id: string = req.params["id"] as string;
    const before = await db.query.engagementsTable.findFirst({
      where: eq(engagementsTable.id, id),
    });
    if (!before) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(engagementsTable)
      .set({ spePath: parsed.data.spePath, updatedAt: new Date() })
      .where(eq(engagementsTable.id, id));
    await audit({
      actorId: req.admin!.userId,
      action: "engagement.update_spe_path",
      entity: "engagement",
      entityId: id,
      diff: { before: { spePath: before.spePath }, after: { spePath: parsed.data.spePath } },
    });
    res.status(204).send();
  },
);

// GET /api/admin/engagements/:id/documents — full list (incl. unpublished
// drafts and soft-deleted rows) for the engagement admin UI.
router.get(
  "/admin/engagements/:id/documents",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id: string = req.params["id"] as string;
    const engagement = await db.query.engagementsTable.findFirst({
      where: eq(engagementsTable.id, id),
    });
    if (!engagement) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(portalDocumentsTable)
      .where(eq(portalDocumentsTable.engagementId, id))
      .orderBy(desc(portalDocumentsTable.indexedAt));
    res.json({
      engagement: {
        id: engagement.id,
        title: engagement.title,
        slug: engagement.slug,
        spePath: engagement.spePath,
      },
      items: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        spePath: r.spePath,
        spaceItemId: r.spaceItemId,
        lastModifiedAt: r.lastModifiedAt ? r.lastModifiedAt.toISOString() : null,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        publishedBy: r.publishedBy,
        indexedAt: r.indexedAt.toISOString(),
        deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      })),
    });
  },
);

// POST /api/admin/engagements/:id/reindex-documents — walk the SPE folder
// and upsert rows. Idempotent; safe to run repeatedly.
router.post(
  "/admin/engagements/:id/reindex-documents",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id: string = req.params["id"] as string;
    try {
      const result = await indexEngagementDocuments(id);
      if (!result) {
        res.status(400).json({
          error:
            "Engagement is missing or has no spePath set. Set the SPE folder path first.",
        });
        return;
      }
      await audit({
        actorId: req.admin!.userId,
        action: "portal_document.reindex",
        entity: "engagement",
        entityId: id,
        diff: result,
      });
      res.json(result);
    } catch (err) {
      req.log.error({ err, engagementId: id }, "reindex failed");
      res.status(502).json({
        error: err instanceof Error ? err.message : "Reindex failed",
      });
    }
  },
);

// POST /api/admin/portal-documents/:id/publish — flag a row as visible to
// clients. Sets publishedAt = now, publishedBy = current admin user.
router.post(
  "/admin/portal-documents/:id/publish",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id: string = req.params["id"] as string;
    const before = await db.query.portalDocumentsTable.findFirst({
      where: eq(portalDocumentsTable.id, id),
    });
    if (!before) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const now = new Date();
    await db
      .update(portalDocumentsTable)
      .set({ publishedAt: now, publishedBy: req.admin!.userId })
      .where(eq(portalDocumentsTable.id, id));
    await audit({
      actorId: req.admin!.userId,
      action: "portal_document.publish",
      entity: "portal_document",
      entityId: id,
      diff: { filename: before.filename, engagementId: before.engagementId },
    });
    res.status(204).send();
  },
);

// POST /api/admin/portal-documents/:id/unpublish — clear the publish flag.
router.post(
  "/admin/portal-documents/:id/unpublish",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id: string = req.params["id"] as string;
    const before = await db.query.portalDocumentsTable.findFirst({
      where: eq(portalDocumentsTable.id, id),
    });
    if (!before) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(portalDocumentsTable)
      .set({ publishedAt: null, publishedBy: null })
      .where(and(eq(portalDocumentsTable.id, id)));
    await audit({
      actorId: req.admin!.userId,
      action: "portal_document.unpublish",
      entity: "portal_document",
      entityId: id,
      diff: { filename: before.filename, engagementId: before.engagementId },
    });
    res.status(204).send();
  },
);

export default router;
