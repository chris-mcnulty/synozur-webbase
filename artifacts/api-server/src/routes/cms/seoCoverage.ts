// #160 — SEO index-coverage dashboard API.
//
// GET  /cms/seo-coverage           — per-artifact-type bucket overview
// GET  /cms/seo-coverage/urls      — drill-down rows (filter by kind/bucket)
// POST /cms/seo-coverage/scan      — trigger an out-of-band rescan
//
// All gated on the `content.moderate` capability (same as the other
// /admin/marketing/* surfaces).

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import {
  getCoverageOverview,
  listCoverageUrls,
  runSeoCoverageScan,
  isScanRunning,
} from "../../lib/seoCoverage";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const guard = [requireAuth, requireCapability("content.moderate")];

router.get("/cms/seo-coverage", ...guard, async (_req, res) => {
  try {
    res.json(await getCoverageOverview());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

const UrlsQuery = z.object({
  kind: z.string().optional(),
  bucket: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get("/cms/seo-coverage/urls", ...guard, async (req, res) => {
  const parsed = UrlsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  try {
    const rows = await listCoverageUrls({
      kind: parsed.data.kind,
      bucket: parsed.data.bucket,
      limit: parsed.data.limit ?? 200,
    });
    res.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/cms/seo-coverage/scan", ...guard, async (_req, res) => {
  if (isScanRunning()) {
    res.status(202).json({ started: false, alreadyRunning: true });
    return;
  }
  // Fire and forget — a full scan hits external APIs and can take minutes.
  void runSeoCoverageScan("manual").catch((err) => {
    logger.error({ err }, "seo.coverage manual scan failed");
  });
  res.status(202).json({ started: true });
});

export default router;
