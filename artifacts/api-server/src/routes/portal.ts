import { Router, type IRouter, type Request } from "express";
import { Readable } from "node:stream";
import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import {
  db,
  usersTable,
  clientOrganizationsTable,
  clientOrganizationUsersTable,
  engagementsTable,
  portalDocumentsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { speFileStorage } from "../lib/storage/spe/fileStorage";
import { audit } from "../lib/audit";

const router: IRouter = Router();

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// GET /api/portal/me — greeting payload: signed-in user, their org, and the
// account-team card (account manager + primary contacts on the join table).
router.get(
  "/portal/me",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const user = req.authedUser!;

    const org = await db.query.clientOrganizationsTable.findFirst({
      where: eq(clientOrganizationsTable.id, orgId),
    });
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const accountTeam: Array<{
      id: string;
      displayName: string | null;
      email: string | null;
      avatarUrl: string | null;
      role: "account_manager" | "primary_contact";
    }> = [];

    if (org.accountManagerUserId) {
      const mgr = await db.query.usersTable.findFirst({
        where: eq(usersTable.id, org.accountManagerUserId),
        columns: { id: true, displayName: true, email: true, avatarUrl: true },
      });
      if (mgr) {
        accountTeam.push({
          id: mgr.id,
          displayName: mgr.displayName,
          email: mgr.email,
          avatarUrl: mgr.avatarUrl,
          role: "account_manager",
        });
      }
    }

    const primaries = await db
      .select({
        id: usersTable.id,
        displayName: usersTable.displayName,
        email: usersTable.email,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(clientOrganizationUsersTable)
      .innerJoin(
        usersTable,
        eq(clientOrganizationUsersTable.userId, usersTable.id),
      )
      .where(
        and(
          eq(clientOrganizationUsersTable.clientOrganizationId, orgId),
          eq(clientOrganizationUsersTable.role, "primary_contact"),
          ne(usersTable.id, user.id),
        ),
      )
      .orderBy(asc(usersTable.displayName));
    for (const p of primaries) {
      // Don't double-list a primary contact who is also the account manager.
      if (accountTeam.some((m) => m.id === p.id)) continue;
      accountTeam.push({ ...p, role: "primary_contact" });
    }

    res.json({
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.isActive,
      },
      accountTeam,
    });
  },
);

// GET /api/portal/engagements — non-deleted, non-archived engagements for the
// signed-in user's org, with the account lead's display info attached.
router.get(
  "/portal/engagements",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const rows = await db
      .select({
        id: engagementsTable.id,
        title: engagementsTable.title,
        slug: engagementsTable.slug,
        status: engagementsTable.status,
        summary: engagementsTable.summary,
        startedAt: engagementsTable.startedAt,
        createdAt: engagementsTable.createdAt,
        leadId: usersTable.id,
        leadDisplayName: usersTable.displayName,
        leadEmail: usersTable.email,
        leadAvatarUrl: usersTable.avatarUrl,
      })
      .from(engagementsTable)
      .leftJoin(
        usersTable,
        eq(engagementsTable.accountLeadUserId, usersTable.id),
      )
      .where(
        and(
          eq(engagementsTable.clientOrganizationId, orgId),
          isNull(engagementsTable.deletedAt),
          ne(engagementsTable.status, "archived"),
        ),
      )
      .orderBy(asc(engagementsTable.title));

    const items = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      summary: r.summary,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      accountLead: r.leadId
        ? {
            id: r.leadId,
            displayName: r.leadDisplayName,
            email: r.leadEmail,
            avatarUrl: r.leadAvatarUrl,
          }
        : null,
    }));

    res.json({ items });
  },
);

// Helper — assert the document belongs to one of the signed-in user's
// engagements. Returns the row + engagement on success, null otherwise.
async function findOwnedDocument(
  documentId: string,
  orgId: string,
): Promise<{
  doc: typeof portalDocumentsTable.$inferSelect;
  engagement: typeof engagementsTable.$inferSelect;
} | null> {
  const doc = await db.query.portalDocumentsTable.findFirst({
    where: and(
      eq(portalDocumentsTable.id, documentId),
      isNull(portalDocumentsTable.deletedAt),
      isNotNull(portalDocumentsTable.publishedAt),
    ),
  });
  if (!doc) return null;
  const engagement = await db.query.engagementsTable.findFirst({
    where: and(
      eq(engagementsTable.id, doc.engagementId),
      eq(engagementsTable.clientOrganizationId, orgId),
      isNull(engagementsTable.deletedAt),
    ),
  });
  if (!engagement) return null;
  return { doc, engagement };
}

// GET /api/portal/documents — paginated list of published deliverables for the
// signed-in user's organization, optionally filtered by engagement.
router.get(
  "/portal/documents",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const engagementIdRaw =
      typeof req.query.engagementId === "string" ? req.query.engagementId : null;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50),
    );

    const conds = [
      eq(engagementsTable.clientOrganizationId, orgId),
      isNull(engagementsTable.deletedAt),
      isNull(portalDocumentsTable.deletedAt),
      isNotNull(portalDocumentsTable.publishedAt),
    ];
    if (engagementIdRaw) {
      conds.push(eq(portalDocumentsTable.engagementId, engagementIdRaw));
    }

    const rows = await db
      .select({
        id: portalDocumentsTable.id,
        engagementId: portalDocumentsTable.engagementId,
        engagementTitle: engagementsTable.title,
        engagementSlug: engagementsTable.slug,
        filename: portalDocumentsTable.filename,
        contentType: portalDocumentsTable.contentType,
        sizeBytes: portalDocumentsTable.sizeBytes,
        lastModifiedAt: portalDocumentsTable.lastModifiedAt,
        publishedAt: portalDocumentsTable.publishedAt,
        webUrl: portalDocumentsTable.webUrl,
        hideHistoryFromCustomer: portalDocumentsTable.hideHistoryFromCustomer,
      })
      .from(portalDocumentsTable)
      .innerJoin(
        engagementsTable,
        eq(portalDocumentsTable.engagementId, engagementsTable.id),
      )
      .where(and(...conds))
      .orderBy(
        asc(engagementsTable.title),
        desc(portalDocumentsTable.publishedAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        engagementId: r.engagementId,
        engagementTitle: r.engagementTitle,
        engagementSlug: r.engagementSlug,
        filename: r.filename,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        lastModifiedAt: r.lastModifiedAt ? r.lastModifiedAt.toISOString() : null,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        hasPreview: Boolean(r.webUrl),
        historyHidden: r.hideHistoryFromCustomer,
      })),
      page,
      pageSize,
    });
  },
);

// GET /api/portal/documents/:id — single document metadata.
router.get(
  "/portal/documents/:id",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const found = await findOwnedDocument(req.params["id"] as string, orgId);
    if (!found) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { doc, engagement } = found;
    res.json({
      id: doc.id,
      engagementId: doc.engagementId,
      engagementTitle: engagement.title,
      engagementSlug: engagement.slug,
      filename: doc.filename,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      lastModifiedAt: doc.lastModifiedAt ? doc.lastModifiedAt.toISOString() : null,
      publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
      hasPreview: Boolean(doc.webUrl),
      historyHidden: doc.hideHistoryFromCustomer,
    });
  },
);

// GET /api/portal/documents/:id/content — stream the file from SPE through
// the api-server. Always emits Content-Disposition: attachment and emits a
// `portal_document.download` audit event so account teams can see who
// retrieved what. The `inline` query toggle lets the preview drawer render
// PDFs/images without forcing a download.
//
// Denial contract for this endpoint (#244): a signed-in customer who
// is in the customer audience but is not entitled to a real document
// — because the doc is unpublished or belongs to another client org —
// receives a 403, not a 404. Soft-deleted rows and unknown ids still
// return 404 (the row is in tombstone state or doesn't exist at all).
// The metadata `/:id` route uses 404 for all of these conditions to
// avoid leaking whether an id exists, but the download route is the
// gate the audit log records as `portal_document.download`, so we
// distinguish "you can't have this" from "no such id" explicitly
// here.
router.get(
  "/portal/documents/:id/content",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const documentId = req.params["id"] as string;
    // Look the row up unconditionally first so we can tell the
    // difference between "no row at all" (404) and "row exists but
    // you don't own it / it's not published" (403).
    const rawDoc = await db.query.portalDocumentsTable.findFirst({
      where: eq(portalDocumentsTable.id, documentId),
    });
    if (!rawDoc || rawDoc.deletedAt) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const found = await findOwnedDocument(documentId, orgId);
    if (!found) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { doc } = found;
    const inline = req.query.inline === "1" || req.query.inline === "true";

    let upstream: Response;
    try {
      upstream = await speFileStorage.getFile(doc.spaceItemId);
    } catch (err) {
      req.log.error({ err, documentId: doc.id }, "portal document download failed");
      res.status(502).json({ error: "Upstream fetch failed" });
      return;
    }

    if (!upstream.body) {
      res.status(502).json({ error: "Upstream empty body" });
      return;
    }

    const contentType =
      upstream.headers.get("content-type") || doc.contentType || "application/octet-stream";
    const safeFilename = doc.filename.replace(/"/g, "");
    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${safeFilename}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);

    // Audit only when the transfer actually completes — aborted or
    // failed downloads must not be recorded as authoritative retrievals,
    // since the audit trail is the canonical "did the customer get the
    // deliverable?" signal. Inline previews (PDF/image rendering inside
    // the drawer) are recorded as `portal_document.preview` so the
    // `download` action stays a clean signal of intentional retrieval.
    let audited = false;
    const recordCompletedTransfer = () => {
      if (audited) return;
      audited = true;
      void audit({
        actorId: req.authedUser!.id,
        action: inline ? "portal_document.preview" : "portal_document.download",
        entity: "portal_document",
        entityId: doc.id,
        diff: {
          filename: doc.filename,
          engagementId: doc.engagementId,
          inline,
        },
      }).catch((err) => {
        req.log.error(
          { err, documentId: doc.id },
          "portal document transfer audit failed",
        );
      });
    };

    const node = Readable.fromWeb(upstream.body as never);
    node.on("error", (err) => {
      req.log.error({ err, documentId: doc.id }, "portal document stream errored");
      if (!res.headersSent) res.status(502);
      if (!res.writableEnded) res.destroy(err);
    });
    res.on("close", () => node.destroy());
    res.on("finish", recordCompletedTransfer);
    node.pipe(res);
  },
);

// GET /api/portal/documents/:id/versions — list prior versions of a
// deliverable. Returns an empty list when the admin has hidden history
// for this document. The newest entry from Graph corresponds to the
// current driveItem; we surface that as `isCurrent: true` so the UI
// can label the active version distinctly.
router.get(
  "/portal/documents/:id/versions",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const found = await findOwnedDocument(req.params["id"] as string, orgId);
    if (!found) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { doc } = found;
    if (doc.hideHistoryFromCustomer) {
      res.json({ items: [] });
      return;
    }
    let versions: Awaited<ReturnType<typeof speFileStorage.listVersions>>;
    try {
      versions = await speFileStorage.listVersions(doc.spaceItemId);
    } catch (err) {
      req.log.error(
        { err, documentId: doc.id },
        "portal document version listing failed",
      );
      res.status(502).json({ error: "Could not list versions" });
      return;
    }
    versions.sort((a, b) => {
      const at = a.lastModifiedDateTime
        ? new Date(a.lastModifiedDateTime).getTime()
        : 0;
      const bt = b.lastModifiedDateTime
        ? new Date(b.lastModifiedDateTime).getTime()
        : 0;
      return bt - at;
    });
    res.json({
      items: versions.map((v, i) => ({
        versionId: v.id,
        lastModifiedAt: v.lastModifiedDateTime ?? null,
        sizeBytes: v.size ?? 0,
        modifiedByDisplayName: v.lastModifiedBy?.user?.displayName ?? null,
        isCurrent: i === 0,
      })),
    });
  },
);

// GET /api/portal/documents/:id/versions/:versionId/content — stream a
// specific historical version. Mirrors the live /content route: same
// auditing, same inline toggle. Hidden-history docs 404 here too so a
// stale link can't bypass the admin restriction.
router.get(
  "/portal/documents/:id/versions/:versionId/content",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const found = await findOwnedDocument(req.params["id"] as string, orgId);
    if (!found) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { doc } = found;
    if (doc.hideHistoryFromCustomer) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const versionId = req.params["versionId"] as string;
    const inline = req.query.inline === "1" || req.query.inline === "true";

    let upstream: Response;
    try {
      upstream = await speFileStorage.getFileVersion(doc.spaceItemId, versionId);
    } catch (err) {
      req.log.error(
        { err, documentId: doc.id, versionId },
        "portal document version download failed",
      );
      res.status(502).json({ error: "Upstream fetch failed" });
      return;
    }
    if (!upstream.body) {
      res.status(502).json({ error: "Upstream empty body" });
      return;
    }

    const contentType =
      upstream.headers.get("content-type") || doc.contentType || "application/octet-stream";
    const safeFilename = doc.filename.replace(/"/g, "");
    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${safeFilename}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);

    let audited = false;
    const recordCompletedTransfer = () => {
      if (audited) return;
      audited = true;
      void audit({
        actorId: req.authedUser!.id,
        action: inline
          ? "portal_document.version_preview"
          : "portal_document.version_download",
        entity: "portal_document",
        entityId: doc.id,
        diff: {
          filename: doc.filename,
          engagementId: doc.engagementId,
          versionId,
          inline,
        },
      }).catch((err) => {
        req.log.error(
          { err, documentId: doc.id, versionId },
          "portal document version transfer audit failed",
        );
      });
    };

    const node = Readable.fromWeb(upstream.body as never);
    node.on("error", (err) => {
      req.log.error(
        { err, documentId: doc.id, versionId },
        "portal document version stream errored",
      );
      if (!res.headersSent) res.status(502);
      if (!res.writableEnded) res.destroy(err);
    });
    res.on("close", () => node.destroy());
    res.on("finish", recordCompletedTransfer);
    node.pipe(res);
  },
);

// GET /api/portal/documents/:id/preview — mint a short-lived M365
// web viewer URL for this driveItem and 302 to it. Uses the Graph
// `driveItem:/preview` action, which returns a tokenized embed URL
// scoped to a single viewing session — distinct from the canonical
// SharePoint `webUrl`, so customers never receive the raw SPE item
// link. Every call is recorded as a `portal_document.preview` audit
// event.
router.get(
  "/portal/documents/:id/preview",
  requireAuth,
  requireCustomerAudience,
  async (req, res) => {
    const orgId = portalOrgId(req);
    const found = await findOwnedDocument(req.params["id"] as string, orgId);
    if (!found) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { doc } = found;
    if (!doc.webUrl) {
      res.status(404).json({ error: "No browser preview available" });
      return;
    }
    let viewerUrl: string | null = null;
    try {
      const containerId = await speFileStorage.resolveContainerId();
      const graph = speFileStorage.graphClient();
      const preview = await graph.getPreviewUrl(containerId, doc.spaceItemId);
      viewerUrl = preview.getUrl;
    } catch (err) {
      req.log.error(
        { err, documentId: doc.id },
        "portal document preview minting failed",
      );
    }
    if (!viewerUrl) {
      res.status(502).json({ error: "Could not generate preview URL" });
      return;
    }
    await audit({
      actorId: req.authedUser!.id,
      action: "portal_document.preview",
      entity: "portal_document",
      entityId: doc.id,
      diff: { filename: doc.filename, engagementId: doc.engagementId },
    });
    res.redirect(302, viewerUrl);
  },
);

export default router;
