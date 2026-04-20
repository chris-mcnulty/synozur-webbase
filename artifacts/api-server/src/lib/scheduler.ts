import { and, eq, lte, isNull } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { audit } from "./audit";
import type { Logger } from "pino";

const TICK_INTERVAL_MS = 60_000;

export function startScheduledPublishWorker(logger: Logger): { stop: () => void } {
  let stopping = false;

  async function tick() {
    if (stopping) return;
    try {
      const now = new Date();
      const due = await db
        .select()
        .from(postsTable)
        .where(
          and(
            eq(postsTable.status, "scheduled"),
            isNull(postsTable.deletedAt),
            lte(postsTable.scheduledFor, now),
          ),
        );
      for (const post of due) {
        await db
          .update(postsTable)
          .set({
            status: "published",
            publishedAt: post.publishedAt ?? now,
            scheduledFor: null,
            updatedAt: now,
          })
          .where(eq(postsTable.id, post.id));
        await audit({
          action: "post.publish_scheduled",
          entity: "post",
          entityId: post.id,
        });
        logger.info({ postId: post.id, slug: post.slug }, "Promoted scheduled post to published");
      }
    } catch (err) {
      logger.error({ err }, "scheduled-publish worker tick failed");
    }
  }

  // Run shortly after boot, then on interval.
  const initial = setTimeout(tick, 5_000);
  const interval = setInterval(tick, TICK_INTERVAL_MS);

  return {
    stop() {
      stopping = true;
      clearTimeout(initial);
      clearInterval(interval);
    },
  };
}
