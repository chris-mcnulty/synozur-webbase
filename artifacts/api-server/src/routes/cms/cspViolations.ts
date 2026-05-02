import { Router, type IRouter } from "express";
import { desc, sql, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { cspViolationsTable } from "@workspace/db/schema";
import { requireCapability } from "../../middlewares/auth";

// #155 / launch readiness L4 — Admin read API for the CSP violations dashboard.
//
// GET  /api/cms/csp/violations       — paginated list, sorted by occurrences desc
// GET  /api/cms/csp/readiness        — enforce-readiness verdict (clean-stream meter)
// DELETE /api/cms/csp/violations/:id — remove a single dedup row

const router: IRouter = Router();

// Required clean-traffic window before flipping CSP_ENFORCE=1, per
// BACKLOG.md "SEO & web-platform debt" #1 ("≥ 7 days against production
// traffic, with violations posted to a new /api/csp/report endpoint").
const CLEAN_DAYS_REQUIRED = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

router.get(
  "/cms/csp/violations",
  requireCapability("site.manage"),
  async (req, res) => {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const directive = typeof req.query["directive"] === "string" ? req.query["directive"] : undefined;

    const baseQuery = db
      .select({
        id: cspViolationsTable.id,
        documentPath: cspViolationsTable.documentPath,
        violatedDirective: cspViolationsTable.violatedDirective,
        effectiveDirective: cspViolationsTable.effectiveDirective,
        blockedUri: cspViolationsTable.blockedUri,
        disposition: cspViolationsTable.disposition,
        statusCode: cspViolationsTable.statusCode,
        occurrences: cspViolationsTable.occurrences,
        firstSeenAt: cspViolationsTable.firstSeenAt,
        lastSeenAt: cspViolationsTable.lastSeenAt,
      })
      .from(cspViolationsTable)
      .$dynamic();

    const filtered = directive
      ? baseQuery.where(sql`${cspViolationsTable.violatedDirective} = ${directive}`)
      : baseQuery;

    const [rows, countRows] = await Promise.all([
      filtered
        .orderBy(desc(cspViolationsTable.occurrences), desc(cspViolationsTable.lastSeenAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(cspViolationsTable)
        .then((r) => r[0]?.count ?? 0),
    ]);

    res.json({
      total: countRows,
      items: rows.map((r) => ({
        id: r.id,
        documentPath: r.documentPath,
        violatedDirective: r.violatedDirective,
        effectiveDirective: r.effectiveDirective,
        blockedUri: r.blockedUri,
        disposition: r.disposition,
        statusCode: r.statusCode,
        occurrences: r.occurrences,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
    });
  },
);

router.get(
  "/cms/csp/readiness",
  requireCapability("site.manage"),
  async (_req, res) => {
    // The header mode is selected at boot from CSP_ENFORCE; mirror the same
    // env-var read so the admin signal stays truthful even if the table is
    // briefly empty after a manual clear.
    const enforcing = process.env["CSP_ENFORCE"] === "1";

    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        totalOccurrences: sql<number>`coalesce(sum(${cspViolationsTable.occurrences}), 0)::int`,
        lastSeenAt: sql<Date | null>`max(${cspViolationsTable.lastSeenAt})`,
      })
      .from(cspViolationsTable);

    const now = Date.now();
    const lastSeenAt = stats?.lastSeenAt ?? null;
    const hoursSinceLast =
      lastSeenAt === null
        ? null
        : Math.floor((now - new Date(lastSeenAt).getTime()) / HOUR_MS);
    const cleanDays =
      lastSeenAt === null
        ? null
        : Math.floor((now - new Date(lastSeenAt).getTime()) / DAY_MS);

    // Verdict ladder — distinct from `enforcing` because an admin can flip
    // the env var at any time; the verdict is the "should we flip yet?" call.
    let verdict: "ready" | "monitoring" | "blocked" | "no-data";
    let reason: string;
    if (stats?.total === 0 && lastSeenAt === null) {
      // Table is empty — either pre-launch, just-cleared, or no traffic at
      // all. We can't recommend "ready" without observing a real traffic
      // window first; admin should monitor for at least the clean-window
      // before treating this as ready.
      verdict = "no-data";
      reason =
        "No violations recorded yet. Wait for production traffic to fill the table before treating this as a clean window.";
    } else if (cleanDays !== null && cleanDays >= CLEAN_DAYS_REQUIRED) {
      verdict = "ready";
      reason = `Last violation was ${cleanDays} day(s) ago — exceeds the ${CLEAN_DAYS_REQUIRED}-day clean window. Safe to set CSP_ENFORCE=1.`;
    } else if (cleanDays !== null && cleanDays >= 1) {
      verdict = "monitoring";
      reason = `Last violation was ${cleanDays} day(s) ago. Need ${CLEAN_DAYS_REQUIRED - cleanDays} more clean day(s) before flipping.`;
    } else {
      verdict = "blocked";
      reason =
        hoursSinceLast === null
          ? "Recent violations are still landing — keep CSP in Report-Only and address the top offenders."
          : `Last violation was ${hoursSinceLast} hour(s) ago. Need a continuous ${CLEAN_DAYS_REQUIRED}-day clean window before flipping.`;
    }

    res.json({
      enforcing,
      verdict,
      reason,
      cleanDaysRequired: CLEAN_DAYS_REQUIRED,
      cleanDaysObserved: cleanDays,
      hoursSinceLast,
      uniqueViolations: stats?.total ?? 0,
      totalOccurrences: stats?.totalOccurrences ?? 0,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
    });
  },
);

router.get(
  "/cms/csp/directives",
  requireCapability("site.manage"),
  async (_req, res) => {
    const rows = await db
      .selectDistinct({ directive: cspViolationsTable.violatedDirective })
      .from(cspViolationsTable)
      .orderBy(asc(cspViolationsTable.violatedDirective));
    res.json(rows.map((r) => r.directive));
  },
);

router.delete(
  "/cms/csp/violations/:id",
  requireCapability("site.manage"),
  async (req, res) => {
    const { id } = req.params;
    await db
      .delete(cspViolationsTable)
      .where(sql`${cspViolationsTable.id} = ${id}::uuid`);
    res.status(204).end();
  },
);

router.delete(
  "/cms/csp/violations",
  requireCapability("site.manage"),
  async (_req, res) => {
    await db.delete(cspViolationsTable);
    res.status(204).end();
  },
);

export default router;
