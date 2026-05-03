import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  portalArtifactsTable,
  clientOrganizationsTable,
  PORTAL_SOURCE_APPS,
  type PortalSourceApp,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { audit } from "../lib/audit";

// Admin write surface for portal artifacts (#226). Account managers populate
// these rows by hand from the client-org edit page in the synozur admin.
// When OAuth provider #128 lands, registered Synozur apps will POST to the
// same endpoints with an `oauth_client` token; for v0 it's admin-only.

const router: IRouter = Router();

const SourceAppEnum = z.enum(
  PORTAL_SOURCE_APPS as readonly [PortalSourceApp, ...PortalSourceApp[]],
);

const CreateBody = z.object({
  clientOrganizationId: z.string().uuid(),
  sourceApp: SourceAppEnum,
  artifactKind: z.string().min(1).max(120),
  title: z.string().min(1).max(255),
  summary: z.string().max(2000).nullish(),
  payload: z.record(z.string(), z.unknown()).nullish(),
  externalUrl: z.string().url().max(2048).nullish(),
  thumbnail: z.string().max(2048).nullish(),
  publishedAt: z.string().datetime().nullish(),
});

const UpdateBody = CreateBody.partial();

// GET /api/cms/portal-artifacts?clientOrganizationId=:id — list everything
// (including archived/deleted rows so admins can restore) for one org.
router.get("/cms/portal-artifacts", requireAdmin, async (req, res) => {
  const orgId = String(req.query.clientOrganizationId ?? "");
  if (!orgId) {
    res.status(400).json({ error: "clientOrganizationId required" });
    return;
  }
  const rows = await db
    .select()
    .from(portalArtifactsTable)
    .where(
      and(
        eq(portalArtifactsTable.clientOrganizationId, orgId),
        isNull(portalArtifactsTable.deletedAt),
      ),
    )
    .orderBy(
      portalArtifactsTable.sourceApp,
      sql`${portalArtifactsTable.publishedAt} desc nulls last`,
      desc(portalArtifactsTable.createdAt),
    );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      clientOrganizationId: r.clientOrganizationId,
      sourceApp: r.sourceApp,
      artifactKind: r.artifactKind,
      title: r.title,
      summary: r.summary,
      payload: r.payload ?? null,
      externalUrl: r.externalUrl,
      thumbnail: r.thumbnail,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

// POST /api/cms/portal-artifacts
router.post("/cms/portal-artifacts", requireAdmin, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, data.clientOrganizationId),
  });
  if (!org) {
    res.status(404).json({ error: "Client organization not found" });
    return;
  }

  const [row] = await db
    .insert(portalArtifactsTable)
    .values({
      clientOrganizationId: data.clientOrganizationId,
      sourceApp: data.sourceApp,
      artifactKind: data.artifactKind,
      title: data.title,
      summary: data.summary ?? null,
      payload: (data.payload ?? null) as Record<string, unknown> | null,
      externalUrl: data.externalUrl ?? null,
      thumbnail: data.thumbnail ?? null,
      publishedAt: data.publishedAt ? new Date(data.publishedAt) : new Date(),
      createdBy: req.admin?.userId ?? null,
    })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Failed to create" });
    return;
  }
  void audit({
    actorId: req.admin?.userId,
    action: "portal_artifact.create",
    entity: "portal_artifact",
    entityId: row.id,
    diff: { sourceApp: row.sourceApp, title: row.title },
  });
  res.status(201).json(row);
});

// PATCH /api/cms/portal-artifacts/:id
router.patch("/cms/portal-artifacts/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? "");
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const update: Partial<typeof portalArtifactsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.sourceApp !== undefined) update.sourceApp = data.sourceApp;
  if (data.artifactKind !== undefined) update.artifactKind = data.artifactKind;
  if (data.title !== undefined) update.title = data.title;
  if (data.summary !== undefined) update.summary = data.summary ?? null;
  if (data.payload !== undefined)
    update.payload = (data.payload ?? null) as Record<string, unknown> | null;
  if (data.externalUrl !== undefined)
    update.externalUrl = data.externalUrl ?? null;
  if (data.thumbnail !== undefined) update.thumbnail = data.thumbnail ?? null;
  if (data.publishedAt !== undefined)
    update.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null;

  const [row] = await db
    .update(portalArtifactsTable)
    .set(update)
    .where(eq(portalArtifactsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// POST /api/cms/portal-artifacts/:id/archive — toggle archivedAt.
router.post(
  "/cms/portal-artifacts/:id/archive",
  requireAdmin,
  async (req, res) => {
    const id = String(req.params.id ?? "");
    const existing = await db.query.portalArtifactsTable.findFirst({
      where: eq(portalArtifactsTable.id, id),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [row] = await db
      .update(portalArtifactsTable)
      .set({
        archivedAt: existing.archivedAt ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(portalArtifactsTable.id, id))
      .returning();
    res.json(row);
  },
);

// DELETE /api/cms/portal-artifacts/:id — soft delete.
router.delete("/cms/portal-artifacts/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? "");
  const [row] = await db
    .update(portalArtifactsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(portalArtifactsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  void audit({
    actorId: req.admin?.userId,
    action: "portal_artifact.delete",
    entity: "portal_artifact",
    entityId: row.id,
  });
  res.json({ ok: true });
});

export default router;
