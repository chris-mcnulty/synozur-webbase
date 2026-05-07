import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, clientOrganizationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { constellation, ConstellationError } from "../lib/constellation";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const guard = [requireAuth, requireCustomerAudience];

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// Resolve the Constellation client ID for the signed-in user's org.
// Returns null if the org has no constellationClientId configured — all routes
// return empty/404 in that case rather than erroring.
async function getConstellationClientId(orgId: string): Promise<string | null> {
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, orgId),
    columns: { constellationClientId: true },
  });
  return org?.constellationClientId ?? null;
}

function handleConstellationError(err: unknown, res: Response) {
  if (err instanceof ConstellationError) {
    if (err.status === 503) {
      logger.error({ err }, "constellation integration not configured");
      res.status(503).json({ error: "Project data unavailable — contact your administrator." });
      return;
    }
    if (err.status === 401 || err.status === 403) {
      logger.error({ err }, "constellation auth error");
      res.status(503).json({ error: "Project data unavailable — contact your administrator." });
      return;
    }
    if (err.status === 404) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ error: "Action cannot be performed in the current state." });
      return;
    }
    logger.error({ err }, "constellation upstream error");
    res.status(502).json({ error: "Service temporarily unavailable. Please try again." });
    return;
  }
  logger.error({ err }, "constellation fetch failed");
  res.status(502).json({ error: "Could not reach Constellation. Please try again." });
}

// ── Projects ──────────────────────────────────────────────────────────────────

router.get("/portal/constellation/projects", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.json({ items: [], nextCursor: null }); return; }
    const { status, limit, cursor } = req.query as Record<string, string | undefined>;
    const data = await constellation.listProjects(clientId, {
      status,
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
      cursor,
    });
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.get("/portal/constellation/projects/:id", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const data = await constellation.getProject(clientId, req.params.id as string);
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

// ── Status reports ────────────────────────────────────────────────────────────

router.get("/portal/constellation/projects/:id/status-reports", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.json({ items: [], nextCursor: null }); return; }
    const { limit, cursor } = req.query as Record<string, string | undefined>;
    const data = await constellation.listStatusReports(clientId, req.params.id as string, {
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
      cursor,
    });
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/status-reports/:id/acknowledge", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    const data = await constellation.acknowledgeStatusReport(clientId, req.params.id as string, comment);
    constellation.bustCache(clientId, "status-reports");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

// ── Milestones ────────────────────────────────────────────────────────────────

router.get("/portal/constellation/projects/:id/milestones", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.json({ items: [], nextCursor: null }); return; }
    const { status, limit, cursor } = req.query as Record<string, string | undefined>;
    const data = await constellation.listMilestones(clientId, req.params.id as string, {
      status,
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
      cursor,
    });
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/milestones/:id/accept", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    const data = await constellation.acceptMilestone(clientId, req.params.id as string, comment);
    constellation.bustCache(clientId, "milestones");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/milestones/:id/reject", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    const data = await constellation.rejectMilestone(clientId, req.params.id as string, comment);
    constellation.bustCache(clientId, "milestones");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

// ── Estimates ─────────────────────────────────────────────────────────────────

router.get("/portal/constellation/estimates/:id", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const data = await constellation.getEstimate(clientId, req.params.id as string);
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/estimates/:id/approve", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    const data = await constellation.approveEstimate(clientId, req.params.id as string, comment);
    constellation.bustCache(clientId, "estimate");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/estimates/:id/request-changes", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    const data = await constellation.requestEstimateChanges(clientId, req.params.id as string, comment);
    constellation.bustCache(clientId, "estimate");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

// ── Invoices ──────────────────────────────────────────────────────────────────

router.get("/portal/constellation/invoices", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.json({ items: [], nextCursor: null }); return; }
    const { limit, cursor } = req.query as Record<string, string | undefined>;
    const data = await constellation.listInvoices(clientId, {
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
      cursor,
    });
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

// ── RAIDD ─────────────────────────────────────────────────────────────────────

router.get("/portal/constellation/projects/:id/raidd", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.json({ items: [], nextCursor: null }); return; }
    const { limit, cursor } = req.query as Record<string, string | undefined>;
    const data = await constellation.listRaidd(clientId, req.params.id as string, {
      limit: limit ? Math.min(200, parseInt(limit, 10)) : 50,
      cursor,
    });
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

router.post("/portal/constellation/raidd/:id/comments", ...guard, async (req, res) => {
  try {
    const clientId = await getConstellationClientId(portalOrgId(req));
    if (!clientId) { res.status(404).json({ error: "Not found." }); return; }
    const { comment } = (req.body ?? {}) as { comment?: string };
    if (!comment?.trim()) {
      res.status(400).json({ error: "comment is required" });
      return;
    }
    const data = await constellation.commentOnRaidd(clientId, req.params.id as string, comment.trim());
    constellation.bustCache(clientId, "raidd");
    res.json(data);
  } catch (err) {
    handleConstellationError(err, res);
  }
});

export default router;
