import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { readOrionTraffic } from "../../lib/orion";

const router = Router();
const query = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  refresh: z.enum(["true", "false"]).optional(),
}).refine((q) => Date.parse(q.from) <= Date.parse(q.to)
  && Date.parse(q.to) - Date.parse(q.from) <= 366 * 86400_000,
{ message: "Choose an ordered reporting period of at most 366 days." });

router.get("/cms/traffic/orion", requireAuth, requireRole("admin", "site_admin", "editor"), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Orion reporting period. Use ISO dates and a range of at most 366 days." });
    return;
  }
  try {
    const { from, to, refresh } = parsed.data;
    const report = await readOrionTraffic(new Date(from).toISOString(), new Date(to).toISOString(), refresh === "true");
    if (report.stale) req.log.warn("Orion traffic refresh failed; serving an explicitly stale snapshot");
    res.json(report);
  } catch {
    req.log.warn("Orion traffic report unavailable");
    res.status(502).json({ error: "Orion reporting is unavailable. Check the portal connection and try again." });
  }
});

export default router;
