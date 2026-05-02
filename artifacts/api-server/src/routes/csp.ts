import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { cspViolationsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

// #155 / launch readiness L4 — CSP violation report ingest.
//
// Browsers POST a JSON body to this endpoint when a CSP directive is
// violated (Report-Only mode) or would have been violated (enforcing mode).
// Two payload shapes are accepted:
//
//   1. Legacy `Content-Security-Policy(-Report-Only): report-uri` format —
//      the body is `{ "csp-report": { ... } }`.
//   2. Modern `Reporting-Endpoints` / `Report-To` format — the body is an
//      array of report objects, each with `type: "csp-violation"`.
//
// Both shapes are normalized into one row per dedup key
// (document_path, violated_directive, blocked_uri); duplicates bump the
// `occurrences` counter and `last_seen_at`.

interface NormalizedReport {
  documentUri: string | null;
  violatedDirective: string | null;
  effectiveDirective: string | null;
  blockedUri: string | null;
  originalPolicy: string | null;
  disposition: string | null;
  statusCode: number | null;
}

function pathOf(uri: string | null | undefined): string {
  if (!uri) return "/";
  try {
    const u = new URL(uri);
    return u.pathname || "/";
  } catch {
    return uri.startsWith("/") ? uri : "/";
  }
}

function trim(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function trimInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeLegacy(body: unknown): NormalizedReport | null {
  if (!body || typeof body !== "object") return null;
  const wrap = (body as { "csp-report"?: unknown })["csp-report"];
  if (!wrap || typeof wrap !== "object") return null;
  const r = wrap as Record<string, unknown>;
  return {
    documentUri: trim(r["document-uri"], 2048),
    violatedDirective: trim(r["violated-directive"], 256),
    effectiveDirective: trim(r["effective-directive"], 256),
    blockedUri: trim(r["blocked-uri"], 2048),
    originalPolicy: trim(r["original-policy"], 4096),
    disposition: trim(r["disposition"], 32),
    statusCode: trimInt(r["status-code"]),
  };
}

function normalizeReportingApi(body: unknown): NormalizedReport[] {
  if (!Array.isArray(body)) return [];
  const out: NormalizedReport[] = [];
  for (const entry of body) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e["type"] !== "csp-violation") continue;
    const body = (e["body"] ?? {}) as Record<string, unknown>;
    out.push({
      documentUri: trim(body["documentURL"], 2048),
      violatedDirective: trim(body["effectiveDirective"], 256),
      effectiveDirective: trim(body["effectiveDirective"], 256),
      blockedUri: trim(body["blockedURL"], 2048),
      originalPolicy: trim(body["originalPolicy"], 4096),
      disposition: trim(body["disposition"], 32),
      statusCode: trimInt(body["statusCode"]),
    });
  }
  return out;
}

async function persistReport(
  report: NormalizedReport,
  rawBody: unknown,
  userAgent: string | null,
): Promise<void> {
  const documentPath = pathOf(report.documentUri);
  const violatedDirective = report.violatedDirective ?? "unknown";
  const blockedUri = report.blockedUri ?? "unknown";

  // UPSERT semantics: bump occurrences + last_seen_at on the dedup key.
  // Postgres ON CONFLICT requires a unique index on the conflict target.
  // The dedup composite is non-unique by design (different policies / UAs
  // shouldn't collide), so we do this as a transactional read + insert/update
  // instead of relying on a synthetic unique constraint.
  await db.transaction(async (tx) => {
    const existing = await tx.execute(sql`
      SELECT id FROM csp_violations
      WHERE document_path = ${documentPath}
        AND violated_directive = ${violatedDirective}
        AND blocked_uri = ${blockedUri}
      ORDER BY first_seen_at ASC
      LIMIT 1
    `);
    const existingId = existing.rows[0]?.["id"] as string | undefined;
    if (existingId) {
      await tx.execute(sql`
        UPDATE csp_violations
        SET occurrences = occurrences + 1,
            last_seen_at = now()
        WHERE id = ${existingId}
      `);
    } else {
      await tx.insert(cspViolationsTable).values({
        documentPath,
        violatedDirective,
        effectiveDirective: report.effectiveDirective,
        blockedUri,
        originalPolicy: report.originalPolicy,
        disposition: report.disposition,
        statusCode: report.statusCode,
        userAgent,
        rawReport: rawBody as object,
      });
    }
  });
}

const router: IRouter = Router();

router.post("/csp/report", async (req, res) => {
  const userAgent = trim(req.headers["user-agent"], 256);
  const body = req.body;

  let reports: NormalizedReport[] = [];
  const legacy = normalizeLegacy(body);
  if (legacy) {
    reports = [legacy];
  } else if (Array.isArray(body)) {
    reports = normalizeReportingApi(body);
  }

  if (reports.length === 0) {
    // Browsers fire-and-forget these; respond 204 even on parse failure so
    // we don't generate noise in browser dev tools. Log so we can spot a
    // payload-shape regression.
    logger.debug({ body }, "csp-report: unrecognized payload shape");
    res.status(204).end();
    return;
  }

  try {
    for (const r of reports) {
      await persistReport(r, body, userAgent);
    }
  } catch (err) {
    logger.warn({ err }, "csp-report: failed to persist violation");
    // Always 204 — the browser doesn't surface this status to anyone, and
    // returning 5xx would put a red error in dev tools without helping.
  }
  res.status(204).end();
});

export default router;
