import { and, eq, lte, isNull } from "drizzle-orm";
import { db, postsTable } from "@workspace/db";
import { audit } from "./audit";
import { reconcileAllEngagementDocuments } from "./portalDocumentIndexer";
import type { Logger } from "pino";

const TICK_INTERVAL_MS = 60_000;
const PORTAL_DOCS_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PORTAL_DOCS_RECONCILE_INITIAL_DELAY_MS = 10 * 60 * 1000;

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

  // #227 — daily reconcile of portal_documents. Walks every active
  // engagement that has an `spePath` set and upserts rows from SPE.
  // Errors are logged per-engagement and never abort the run.
  let reconcileRunning = false;
  async function reconcileTick() {
    if (stopping || reconcileRunning) return;
    reconcileRunning = true;
    try {
      await reconcileAllEngagementDocuments();
    } catch (err) {
      logger.error({ err }, "portal-document daily reconcile crashed");
    } finally {
      reconcileRunning = false;
    }
  }
  const reconcileInitial = setTimeout(reconcileTick, PORTAL_DOCS_RECONCILE_INITIAL_DELAY_MS);
  const reconcileInterval = setInterval(reconcileTick, PORTAL_DOCS_RECONCILE_INTERVAL_MS);

  return {
    stop() {
      stopping = true;
      clearTimeout(initial);
      clearInterval(interval);
      clearTimeout(reconcileInitial);
      clearInterval(reconcileInterval);
    },
  };
}
