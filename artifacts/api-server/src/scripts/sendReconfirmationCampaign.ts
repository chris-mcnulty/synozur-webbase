/**
 * #259 — One-shot re-confirmation campaign for the pre-DOI subscriber list.
 *
 * Background: before the double-opt-in flow shipped, /forms/subscribe
 * directly upserted the subscriber. Those rows were grandfathered into the
 * `subscribers` table at status='confirmed' (see backfill in #259). To bring
 * the existing list into compliance with GDPR Recital 32 / CASL we mail
 * each one a "confirm to keep receiving" link once and rotate them to
 * status='pending' so non-confirmers stop receiving marketing.
 *
 * Behavior:
 *   - DRY-RUN by default: prints how many addresses would be re-confirmed.
 *   - Pass --apply to actually rotate rows to 'pending', issue a fresh
 *     confirmation token, and send the email.
 *   - Idempotent: skips rows that are already 'pending' or 'unsubscribed'.
 *   - --limit=N caps how many rows are processed in one run (default: all).
 *   - --since=YYYY-MM-DD restricts to rows confirmed (or created, for
 *     pre-DOI rows where confirmedAt is null) on/after the given date.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/sendReconfirmationCampaign.ts -- --apply --limit=500
 */

import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, subscribersTable } from "@workspace/db";
import { signSubscriberConfirmToken } from "../lib/subscriberToken";
import { sendSubscriptionConfirmation } from "../lib/email";
import { siteOrigin } from "../lib/siteOrigin";
import { logger } from "../lib/logger";

interface Args {
  apply: boolean;
  limit: number | null;
  since: Date | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null, since: null };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    } else if (a.startsWith("--since=")) {
      const d = new Date(a.slice("--since=".length));
      if (!Number.isNaN(d.getTime())) args.since = d;
    }
  }
  return args;
}

function buildConfirmUrl(token: string): string {
  return `${siteOrigin()}/api/forms/subscribe/confirm?token=${encodeURIComponent(token)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ args }, "reconfirmation campaign starting");

  // Target ONLY grandfathered (pre-DOI) rows. `grandfathered_at` is set by
  // the startup backfill; organically DOI-confirmed subscribers added after
  // launch have it null, so this script can never re-mail them by accident.
  const conditions = [
    eq(subscribersTable.status, "confirmed"),
    isNotNull(subscribersTable.grandfatheredAt),
  ];
  if (args.since) {
    const sinceClause = or(
      gte(subscribersTable.confirmedAt, args.since),
      and(isNull(subscribersTable.confirmedAt), gte(subscribersTable.createdAt, args.since)),
    );
    if (sinceClause) conditions.push(sinceClause);
  }
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const baseQuery = db.select().from(subscribersTable);
  const filtered = where ? baseQuery.where(where) : baseQuery;
  const rows = args.limit ? await filtered.limit(args.limit) : await filtered;

  logger.info({ count: rows.length, apply: args.apply }, "reconfirmation candidates");
  if (!args.apply) {
    console.log(
      `[dry-run] Would mail ${rows.length} subscribers. Re-run with --apply to send.`,
    );
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { token, hash } = signSubscriberConfirmToken(row.id);
      await db
        .update(subscribersTable)
        .set({
          status: "pending",
          confirmationTokenHash: hash,
          confirmationSentAt: new Date(),
        })
        .where(eq(subscribersTable.id, row.id));
      const r = await sendSubscriptionConfirmation({
        to: row.email,
        confirmUrl: buildConfirmUrl(token),
      });
      if (r.status === "error") {
        failed += 1;
        logger.warn({ subscriberId: row.id, error: r.error }, "reconfirmation send failed");
      } else {
        sent += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error({ err, subscriberId: row.id }, "reconfirmation row failed");
    }
  }

  // Belt-and-braces: confirm the funnel actually moved.
  const counts = await db
    .select({ status: subscribersTable.status, n: sql<number>`count(*)::int` })
    .from(subscribersTable)
    .groupBy(subscribersTable.status);
  console.log(`Reconfirmation complete: sent=${sent} failed=${failed}`);
  console.log("Funnel after run:", counts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "reconfirmation campaign crashed");
    process.exit(1);
  });
