import { Router, type IRouter } from "express";
import { desc, sql, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { cspViolationsTable } from "@workspace/db/schema";
import { requireCapability } from "../../middlewares/auth";

// #155 / launch readiness L4 — Admin read API for the CSP violations dashboard.
//
// GET  /api/cms/csp/violations       — paginated list, sorted by occurrences desc
// DELETE /api/cms/csp/violations/:id — remove a single dedup row

const router: IRouter = Router();

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
