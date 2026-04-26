import { Router, type IRouter, type Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db, cwvSamplesTable } from "@workspace/db";

const router: IRouter = Router();

// #142 Phase B — Public, unauthenticated CWV sample ingest. The web-vitals
// SDK on the marketing site posts one row per metric per page session.
// Validation is tight (Zod + per-metric caps + per-IP rate limit) so a
// malformed bot payload can't bloat the table or skew percentiles. No
// CAPTCHA: the worst case is bogus performance data, not a write that
// affects business state.

// Per-metric upper bounds. Time-based metrics (LCP/INP/FCP/TTFB) cap at
// 10 minutes — anything past that is almost certainly a frozen tab or
// a clock skew artifact. CLS is unitless and almost always < 1; we cap
// at 100 to reject obvious garbage without rejecting slow-to-stabilize
// pages.
const VALUE_BOUNDS: Record<string, number> = {
  LCP: 600_000,
  INP: 600_000,
  FCP: 600_000,
  TTFB: 600_000,
  CLS: 100,
};

const CwvBody = z
  .object({
    // Cap the route to a sane length so a pathological URL doesn't bloat
    // the table. Must be a pathname — no host, no query string, no
    // fragment, so the server never persists data that could leak PII
    // through request parameters.
    route: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .startsWith("/", { message: "Route must be a pathname starting with '/'" })
      .refine((route) => !route.includes("?") && !route.includes("#"), {
        message: "Route must not include a query string or fragment",
      }),
    metric: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
    value: z.number().min(0),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    navigationType: z.string().max(64).nullish(),
    metricId: z.string().max(128).nullish(),
  })
  .superRefine((v, ctx) => {
    const max = VALUE_BOUNDS[v.metric];
    if (max != null && v.value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        path: ["value"],
        type: "number",
        inclusive: true,
        maximum: max,
        message: `value for ${v.metric} must not exceed ${max}`,
      });
    }
  });

function ipKey(req: { headers: Record<string, unknown>; ip?: string }): string {
  const fwd = req.headers["x-forwarded-for"];
  let ip = req.ip ?? "unknown";
  if (typeof fwd === "string" && fwd.length > 0) {
    ip = fwd.split(",")[0]!.trim();
  }
  return ipKeyGenerator(ip);
}

// Per-IP cap. web-vitals fires ~5 metrics per page session; a real user
// rarely emits more than ~20/min even with aggressive SPA navigation,
// so 120/min/IP gives plenty of headroom while keeping bots from
// flooding the table.
const cwvLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `cwv:${ipKey(req)}`,
  // Drop overflow silently — the client uses sendBeacon and won't
  // retry, and the metric is just sampling noise at the limit.
  handler: (_req, res) => {
    res.status(204).end();
  },
});

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 256) : null;
}

router.post("/metrics/cwv", cwvLimiter, async (req, res) => {
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
