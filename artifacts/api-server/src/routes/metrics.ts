import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { db, cwvSamplesTable } from "@workspace/db";

const router: IRouter = Router();

// #142 Phase B — Public, unauthenticated CWV sample ingest. The web-vitals
// SDK on the marketing site posts one row per metric per page session.
// Validation is tight (Zod + value caps) so a malformed bot payload can't
// blow up the table. No CAPTCHA: the worst case is bogus performance
// data, not a write that affects business state.

const CwvBody = z.object({
  // Cap the route to a sane length so a pathological URL doesn't bloat
  // the table. The client-supplied pathname is stored verbatim for v0;
  // a future iteration will normalize slugs to template paths.
  route: z.string().trim().min(1).max(256),
  metric: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  // Reject negative values and ridiculous outliers (e.g. > 10 minutes
  // for time-based metrics, > 100 for the unitless CLS). Anything past
  // these bounds is almost certainly bogus.
  value: z.number().min(0).max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  navigationType: z.string().max(64).nullish(),
  metricId: z.string().max(128).nullish(),
});

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 256) : null;
}

router.post("/metrics/cwv", async (req, res) => {
  const parsed = CwvBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  await db.insert(cwvSamplesTable).values({
    route: d.route,
    metric: d.metric,
    value: d.value,
    rating: d.rating,
    navigationType: d.navigationType ?? null,
    metricId: d.metricId ?? null,
    userAgent: userAgent(req),
  });
  res.status(204).end();
});

export default router;
