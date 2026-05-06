import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { nebula, NebulaError } from "../lib/nebula";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const guard = [requireAuth, requireCustomerAudience];

function handleNebulaError(err: unknown, res: Parameters<Parameters<typeof router.get>[1]>[1]) {
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
  // Network timeout (AbortError) or unexpected
  logger.error({ err }, "nebula fetch failed");
  res.status(502).json({ error: "Could not reach Nebula. Please try again." });
}

// GET /portal/nebula/reports
router.get("/portal/nebula/reports", ...guard, async (req, res) => {
  try {
    const { page, limit, domain } = req.query as Record<string, string | undefined>;
    const data = await nebula.listReports({ page, limit, domain });
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

// GET /portal/nebula/reports/:spaceId
router.get("/portal/nebula/reports/:spaceId", ...guard, async (req, res) => {
  const spaceId = String(req.params.spaceId);
  try {
    const data = await nebula.getReport(spaceId);
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

// GET /portal/nebula/workspaces
router.get("/portal/nebula/workspaces", ...guard, async (req, res) => {
  try {
    const { domain } = req.query as Record<string, string | undefined>;
    const data = await nebula.listWorkspaces({ domain });
    res.json(data);
  } catch (err) {
    handleNebulaError(err, res);
  }
});

export default router;
