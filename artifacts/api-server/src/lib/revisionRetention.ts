import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, revisionsTable } from "@workspace/db";
import type { Logger } from "pino";

const DEFAULT_MAX_REVISIONS_PER_POST = 50;
const MIN_MAX_REVISIONS_PER_POST = 1;

const RETENTION_TICK_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_INITIAL_DELAY_MS = 60_000;

export function getMaxRevisionsPerPost(): number {
  const raw = process.env.MAX_REVISIONS_PER_POST;
  if (!raw) return DEFAULT_MAX_REVISIONS_PER_POST;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_MAX_REVISIONS_PER_POST) {
    return DEFAULT_MAX_REVISIONS_PER_POST;
  }
  return parsed;
}

// Delete revisions for `postId` beyond the most recent `max` rows. Safe to
// call after any insert into revisionsTable; it is a no-op when the post
// already has <= max revisions.
export async function trimPostRevisions(
  postId: string,
  max: number = getMaxRevisionsPerPost(),
): Promise<number> {
  if (max < MIN_MAX_REVISIONS_PER_POST) return 0;
  // Tie-break on id so that revisions sharing an edited_at timestamp have
  // a deterministic kept/deleted boundary.
  const stale = await db
    .select({ id: revisionsTable.id })
    .from(revisionsTable)
    .where(eq(revisionsTable.postId, postId))
    .orderBy(desc(revisionsTable.editedAt), desc(revisionsTable.id))
    .offset(max);
  if (stale.length === 0) return 0;
  await db
    .delete(revisionsTable)
    .where(
      inArray(
        revisionsTable.id,
        stale.map((r) => r.id),
      ),
    );
  return stale.length;
}

// Periodic backstop: trims any post whose history exceeds the cap. Catches
// pre-existing oversize histories from before on-write trim shipped, and
// any post whose on-write trim was skipped (e.g. transient failure).
export function startRevisionRetentionWorker(logger: Logger): {
  stop: () => void;
} {
  let stopping = false;

  async function tick() {
    if (stopping) return;
    const max = getMaxRevisionsPerPost();
    try {
      const oversized = await db
        .select({
          postId: revisionsTable.postId,
          count: sql<number>`count(*)::int`,
        })
        .from(revisionsTable)
        .groupBy(revisionsTable.postId)
        .having(sql`count(*) > ${max}`);
      let totalDeleted = 0;
      for (const row of oversized) {
        if (stopping) break;
        try {
          const deleted = await trimPostRevisions(row.postId, max);
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            { err, postId: row.postId },
            "revision-retention worker: trim failed for post",
          );
        }
      }
      if (totalDeleted > 0 || oversized.length > 0) {
        logger.info(
          { posts: oversized.length, deleted: totalDeleted, max },
          "revision-retention worker: pruned old revisions",
        );
      }
    } catch (err) {
      logger.error({ err }, "revision-retention worker tick failed");
    }
  }

  const initial = setTimeout(tick, RETENTION_INITIAL_DELAY_MS);
  const interval = setInterval(tick, RETENTION_TICK_INTERVAL_MS);

  return {
    stop() {
      stopping = true;
      clearTimeout(initial);
      clearInterval(interval);
    },
  };
}
