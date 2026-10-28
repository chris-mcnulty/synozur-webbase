import { sql } from "drizzle-orm";
import { db, collateralTable, whitePapersTable } from "@workspace/db";
import { logger } from "./logger";

// Repair assignments missed by the old mirror sync, without touching nonblank
// collateral assignments or creating/removing any manually curated links.
// Idempotent content-only UPDATE; no schema changes.
export async function seedWhitePaperAssignmentsIfMissing(): Promise<void> {
  try {
    const repaired = await db.execute(sql`
      UPDATE ${collateralTable} AS c
      SET solution_id = w.solution_id,
          service_id = COALESCE(c.service_id, w.service_id),
          updated_at = now()
      FROM ${whitePapersTable} AS w
      WHERE c.source_id = 'white_paper:' || w.id::text
        AND c.solution_id IS NULL
        AND w.solution_id IS NOT NULL
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL
      RETURNING c.id
    `);
    if (repaired.rowCount) {
      logger.info({ count: repaired.rowCount }, "Repaired missing white paper/ebook solution assignments");
    }
  } catch (err) {
    logger.error({ err }, "Could not repair missing white paper/ebook solution assignments");
  }
}