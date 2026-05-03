/**
 * #131 — One-shot backlog migration of existing `form_submissions` rows
 * into the HubSpot sync queue. Iterates rows whose `hubspotSyncStatus` is
 * still null and `enqueueContactSubmission`s them so the same worker that
 * handles new traffic delivers the historical contacts and timeline
 * events with consistent attribution.
 *
 * Usage:
 *   # Dry-run — count what would be enqueued, no DB writes.
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/migrateSubmissionsToHubspot.ts
 *
 *   # Apply.
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/migrateSubmissionsToHubspot.ts -- --apply
 *
 *   # Restrict to a form type.
 *   ... -- --apply --form-type=subscribe
 *
 *   # Limit batch size (default: every eligible row).
 *   ... -- --apply --limit=500
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, formSubmissionsTable, pool } from "@workspace/db";
import {
  ALL_FORM_TYPES,
  computeTimelineTokens,
  enqueueContactSubmission,
  type FormType,
} from "../lib/hubspotSync";

// Defaults from CLI argv. The named runner below (`runHubspotBacklogMigration`)
// overrides these so the function can be invoked from the api-server
// startup hook without simulating argv.
const APPLY_FROM_CLI = process.argv.includes("--apply");
const FORM_TYPE_FROM_CLI = process.argv.find((a) => a.startsWith("--form-type="))?.slice(12);
const LIMIT_FROM_CLI = process.argv.find((a) => a.startsWith("--limit="))?.slice(8);
let APPLY = APPLY_FROM_CLI;
let FORM_TYPE_ARG: string | undefined = FORM_TYPE_FROM_CLI;
let LIMIT_ARG: string | undefined = LIMIT_FROM_CLI;
let CLOSE_POOL = true;

const VALID_FORM_TYPES: ReadonlySet<FormType> = new Set(ALL_FORM_TYPES);

function asFormType(value: string): FormType | null {
  return (VALID_FORM_TYPES as ReadonlySet<string>).has(value) ? (value as FormType) : null;
}

// #131 — Reusable runner so the api-server can invoke the backlog
// migration idempotently on first deploy / startup as well as via the
// CLI. The migration is naturally idempotent: it only enqueues rows
// whose `hubspotSyncStatus IS NULL`, and marks them `queued` on success.
export async function runHubspotBacklogMigration(opts?: {
  apply?: boolean;
  formType?: string;
  limit?: number;
  closePool?: boolean;
}): Promise<void> {
  if (opts?.apply !== undefined) APPLY = opts.apply;
  if (opts?.formType !== undefined) FORM_TYPE_ARG = opts.formType;
  if (opts?.limit !== undefined) LIMIT_ARG = String(opts.limit);
  if (opts?.closePool !== undefined) CLOSE_POOL = opts.closePool;
  await main();
}

async function main(): Promise<void> {
  console.log(`HubSpot backlog migration (apply=${APPLY})`);

  if (FORM_TYPE_ARG) {
    if (!asFormType(FORM_TYPE_ARG)) {
      console.error(`Unknown --form-type=${FORM_TYPE_ARG}. Valid: ${Array.from(VALID_FORM_TYPES).join(", ")}`);
      process.exit(1);
    }
  }

  const limit = LIMIT_ARG ? Math.max(1, Number.parseInt(LIMIT_ARG, 10)) : null;

  const conditions = [
    isNull(formSubmissionsTable.hubspotSyncStatus),
    sql`${formSubmissionsTable.email} IS NOT NULL AND length(trim(${formSubmissionsTable.email})) > 0`,
  ];
  if (FORM_TYPE_ARG) {
    conditions.push(eq(formSubmissionsTable.formType, FORM_TYPE_ARG));
  }
  const where = and(...conditions);

  const baseQuery = db.select().from(formSubmissionsTable).where(where).orderBy(asc(formSubmissionsTable.id));
  const rows = limit ? await baseQuery.limit(limit) : await baseQuery;

  console.log(`Eligible rows: ${rows.length}${FORM_TYPE_ARG ? ` (form_type=${FORM_TYPE_ARG})` : ""}`);
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.formType] = (byType[r.formType] ?? 0) + 1;
  for (const [t, n] of Object.entries(byType).sort()) {
    console.log(`  ${t.padEnd(12)} ${n}`);
  }

  if (!APPLY) {
    console.log("\nDry-run. Re-run with --apply to enqueue these rows.");
    if (CLOSE_POOL) await pool.end();
    return;
  }

  let enqueued = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const formType = asFormType(row.formType);
    if (!formType) {
      skipped += 1;
      continue;
    }
    if (!row.email) {
      skipped += 1;
      continue;
    }
    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      // Reconstruct the same hutk + timeline tokens a live submit would
      // produce, so backfilled rows yield identical contact upserts and
      // timeline events to ones written by the public form handlers.
      const hutk = typeof payload["hubspotutk"] === "string"
        ? (payload["hubspotutk"] as string)
        : typeof payload["hutk"] === "string"
          ? (payload["hutk"] as string)
          : null;
      await enqueueContactSubmission({
        formType,
        submissionId: row.id,
        email: row.email,
        name: row.name ?? null,
        company: row.company ?? null,
        marketingOptIn: row.marketingOptIn ?? false,
        payload,
        utm: {
          source: row.utmSource,
          medium: row.utmMedium,
          campaign: row.utmCampaign,
          term: row.utmTerm,
          content: row.utmContent,
          landingPage: row.landingPage,
          referrer: row.referrer,
        },
        hutk,
        timelineTokens: computeTimelineTokens(formType, payload),
      });
      // Mark the row as queued so a re-run doesn't double-enqueue.
      await db
        .update(formSubmissionsTable)
        .set({ hubspotSyncStatus: "queued" })
        .where(eq(formSubmissionsTable.id, row.id));
      enqueued += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ✗ id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (enqueued > 0 && enqueued % 100 === 0) {
      console.log(`  …enqueued ${enqueued}`);
    }
  }

  console.log(`\nDone. enqueued=${enqueued} skipped=${skipped} failed=${failed}`);
  console.log("The HubSpot worker will drain the queue on its next tick (default every 30s).");
  if (CLOSE_POOL) await pool.end();
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch(async (err) => {
    console.error(err);
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
