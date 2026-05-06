import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, clientOrganizationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { nebula, NebulaError } from "../lib/nebula";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const guard = [requireAuth, requireCustomerAudience];

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// Look up the primary email domain for the signed-in user's client org.
// Used to scope umbrella-key calls to Nebula via ?domain=. Returns null if
// the org has no approvedEmailDomains configured (Nebula will then return
// an empty list, which is the safe default).
async function getOrgDomain(orgId: string): Promise<string | null> {
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, orgId),
    columns: { approvedEmailDomains: true },
  });
  const domains = org?.approvedEmailDomains ?? [];
  return domains.length > 0 ? domains[0] : null;
}

function handleNebulaError(err: unknown, res: Response) {
  if (err instanceof NebulaError) {
    if (err.status === 401 || err.status === 503) {
      logger.error({ err }, "nebula auth/config error");
      res.status(503).json({ error: "Data unavailable — contact your administrator." });
      return;
    }
    if (err.status === 403) {
      res.status(403).json({ error: "You do not have access to this report." });
      return;
    }
    if (err.status === 404) {
      res.status(404).json({ error: "Report not yet generated or workspace not found." });
      return;
    }
    logger.error({ err }, "nebula upstream error");
    res.status(502).json({ error: "Service temporarily unavailable. Please try again." });
    return;
  }
  logger.error({ err }, "nebula fetch failed");
  res.status(502).json({ error: "Could not reach Nebula. Please try again." });
}

// GET /portal/nebula/reports — paginated list scoped to the signed-in user's org.
router.get("/portal/nebula/reports", ...guard, async (req, res) => {
  try {
    const { page, limit } = req.query as Record<string, string | undefined>;
    const domain = await getOrgDomain(portalOrgId(req));
    if (!domain) {
      // Org has no domains configured → can't scope upstream → return empty.
      res.json({ data: [], page: Number(page) || 1, limit: Number(limit) || 20, total: 0 });
      return;
    }
    const data = await nebula.listReports({ page, limit, domain });
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

// GET /portal/nebula/reports/:spaceId — full report. Upstream enforces 403
// when the workspace does not belong to an umbrella org, so no domain param
// is needed here.
router.get("/portal/nebula/reports/:spaceId", ...guard, async (req, res) => {
  const spaceId = String(req.params.spaceId);
  try {
    const data = await nebula.getReport(spaceId);
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

// GET /portal/nebula/workspaces — directory scoped to signed-in user's org.
router.get("/portal/nebula/workspaces", ...guard, async (req, res) => {
  try {
    const domain = await getOrgDomain(portalOrgId(req));
    if (!domain) {
      res.json({ data: [] });
      return;
    }
    const data = await nebula.listWorkspaces({ domain });
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

export default router;
