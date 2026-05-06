import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, clientOrganizationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { requireCustomerAudience } from "../middlewares/requireCustomerAudience";
import { orion, OrionError } from "../lib/orion";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const guard = [requireAuth, requireCustomerAudience];

function portalOrgId(req: Request): string {
  const id = (req as Request & { portalOrgId?: string }).portalOrgId;
  if (!id) throw new Error("portalOrgId missing — middleware order?");
  return id;
}

// Resolve the primary email domain for the signed-in user's client org.
// This is used to scope all Orion calls so each org sees only its own data.
// Returns null when the org has no approvedEmailDomains — routes respond with
// empty data in that case (same behaviour as the Nebula proxy).
async function getOrgDomain(orgId: string): Promise<string | null> {
  const org = await db.query.clientOrganizationsTable.findFirst({
    where: eq(clientOrganizationsTable.id, orgId),
    columns: { approvedEmailDomains: true },
  });
  const domains = org?.approvedEmailDomains ?? [];
  return domains.length > 0 ? domains[0] : null;
}

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

// GET /portal/orion/models
router.get("/portal/orion/models", ...guard, async (req, res) => {
  try {
    const domain = await getOrgDomain(portalOrgId(req));
    if (!domain) { res.json([]); return; }
    const data = await orion.getModels(domain);
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/courses
router.get("/portal/orion/courses", ...guard, async (req, res) => {
  try {
    const domain = await getOrgDomain(portalOrgId(req));
    if (!domain) { res.json([]); return; }
    const data = await orion.getCourses(domain);
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/results
router.get("/portal/orion/results", ...guard, async (req, res) => {
  try {
    const domain = await getOrgDomain(portalOrgId(req));
    if (!domain) { res.json([]); return; }
    const data = await orion.getResults(domain);
    res.json(data);
  } catch (err) {
    handleOrionError(err, res);
  }
});

// GET /portal/orion/traffic — polled by background worker, no per-org scoping
// needed (traffic is app-wide). Still gated behind customer audience so it is
// not publicly reachable.
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
