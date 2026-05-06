import { Router, type IRouter, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { orion, OrionError } from "../lib/orion";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const guard = [requireAuth, requireCustomerAudience];

function handleOrionError(err: unknown, res: Response) {
  if (err instanceof OrionError) {
    if (err.status === 401 || err.status === 403 || err.status === 503) {
      logger.error({ err }, "orion auth/config error");
      res.status(503).json({ error: "Orion data unavailable — contact your administrator." });
      return;
    }
    if (err.status === 404) {
      logger.warn({ err }, "orion domain not found");
      res.status(404).json({ error: "Domain not registered in Orion." });
      return;
    }
    logger.error({ err }, "orion upstream error");
    res.status(502).json({ error: "Orion service temporarily unavailable. Please try again." });
    return;
  }
  logger.error({ err }, "orion fetch failed");
  res.status(502).json({ error: "Could not reach Orion. Please try again." });
}

// GET /portal/orion/models — published assessment models for this org's domain.
router.get("/portal/orion/models", ...guard, async (_req, res) => {
  try {
    const data = await orion.getModels();
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/courses — published courses available to this org.
router.get("/portal/orion/courses", ...guard, async (_req, res) => {
  try {
    const data = await orion.getCourses();
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/results — anonymised aggregate maturity scores.
router.get("/portal/orion/results", ...guard, async (_req, res) => {
  try {
    const data = await orion.getResults();
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/traffic — app-wide traffic stats. Not called on page
// load — consumed by admin reporting and the background poller. Still gated
// behind customer audience so it is not publicly reachable.
router.get("/portal/orion/traffic", ...guard, async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  try {
    const data = await orion.getTraffic(from, to);
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

export default router;
