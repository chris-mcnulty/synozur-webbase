/**
 * #56 one-off backfill: mark existing services and solutions `published`.
 *
 * When the `status` column is added via `drizzle-kit push`, Postgres fills
 * every existing row with the schema default (`draft`) — which would
 * silently hide every live service and solution. Run this script once,
 * immediately after the push that adds the column, to restore their
 * public visibility:
 *
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/backfillServicesStatus.ts
 *
 * The update is idempotent: it only touches rows whose current status is
 * `draft` and have never been explicitly set to a different value. Once
 * editors start using the draft/published toggle, this script should not
 * be re-run — rerunning after an editor has drafted a row would flip it
 * back to published. The safest long-term stance is to delete this file
 * after the production cutover.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

async function main() {
  const services = await db.execute(
    sql`update services set status = 'published' where status = 'draft' returning id`,
  );
  const solutions = await db.execute(
    sql`update solutions set status = 'published' where status = 'draft' returning id`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `Backfilled ${services.rowCount ?? 0} services and ${solutions.rowCount ?? 0} solutions to status=published.`,
  );
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
