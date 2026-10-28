// #160 — SEO index-coverage dashboard API.
//
// GET  /cms/seo-coverage                           — per-artifact-type bucket overview
// GET  /cms/seo-coverage/urls                      — drill-down rows (filter by kind/bucket)
// GET  /cms/seo-coverage/runs/:runId/resubmitted   — resubmitted URL list for a past run
// POST /cms/seo-coverage/scan                      — trigger an out-of-band rescan
//
// All gated on the `content.moderate` capability (same as the other
// /admin/marketing/* surfaces).

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../middlewares/auth";
import {
  getCoverageOverview,
  listCoverageUrls,
  getRunResubmittedUrls,
  listRecentRuns,
  startSeoCoverageScan,
  checkCredentials,
} from "../../lib/seoCoverage";

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

router.get("/cms/seo-coverage/preflight", ...guard, async (_req, res) => {
  try {
    res.json(await checkCredentials());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/cms/seo-coverage/runs", ...guard, async (_req, res) => {
  try {
    const runs = await listRecentRuns(30);
    res.json({ runs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

const RunIdParam = z.object({ runId: z.string().uuid() });

router.get("/cms/seo-coverage/runs/:runId/resubmitted", ...guard, async (req, res) => {
  const parsed = RunIdParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid run ID" });
    return;
  }
  try {
    const rows = await getRunResubmittedUrls(parsed.data.runId);
    res.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/cms/seo-coverage/scan", ...guard, async (_req, res): Promise<void> => {
  try {
    // The scanner obtains its advisory lock before this response is sent, so
    // the UI can distinguish a new run from a scanner held by another request.
    res.status(202).json(await startSeoCoverageScan("manual"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
