import { Router, type IRouter } from "express";
import { requireCapability } from "../../middlewares/auth";
import { getLaunchReadinessReport } from "../../lib/launchReadiness.js";

// Launch-readiness diagnostic surface — admin read API. Mirrors the
// startup-log emitter `logLaunchReadiness()` but returns the same data
// as JSON so an admin doesn't need to grep server logs to see whether
// L2 / L3 / L5 env vars are set in the running deployment.

const router: IRouter = Router();

router.get(
  "/cms/launch-readiness",
  requireCapability("site.manage"),
  async (_req, res) => {
    const report = await getLaunchReadinessReport();
    res.json(report);
  },
);

export default router;
