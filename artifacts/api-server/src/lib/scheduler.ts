import { and, eq, lt, lte, isNull, sql } from "drizzle-orm";
import { db, postsTable, subscribersTable } from "@workspace/db";
import { audit } from "./audit";
import { reconcileAllEngagementDocuments } from "./portalDocumentIndexer";
import type { Logger } from "pino";

const TICK_INTERVAL_MS = 60_000;
const PORTAL_DOCS_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PORTAL_DOCS_RECONCILE_INITIAL_DELAY_MS = 10 * 60 * 1000;
const SUBSCRIBERS_PENDING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUBSCRIBERS_PENDING_CLEANUP_INITIAL_DELAY_MS = 15 * 60 * 1000;
const SUBSCRIBERS_PENDING_TTL_DAYS = 30;

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

  // #259 — daily cleanup of pending DOI subscribers older than the TTL.
  // Pending rows that never confirmed within 30 days are deleted so the
  // funnel stays meaningful and we don't accumulate unconfirmed addresses
  // indefinitely.
  let pendingCleanupRunning = false;
  async function pendingCleanupTick() {
    if (stopping || pendingCleanupRunning) return;
    pendingCleanupRunning = true;
    try {
      // Use the most recent of confirmation_sent_at / created_at as the
      // cutoff anchor so a freshly resent confirmation link is never deleted
      // mid-window. A row only ages out if its *latest* confirmation issue
      // is older than the TTL.
      const cutoff = new Date(Date.now() - SUBSCRIBERS_PENDING_TTL_DAYS * 24 * 60 * 60 * 1000);
      const deleted = await db
        .delete(subscribersTable)
        .where(
          and(
            eq(subscribersTable.status, "pending"),
            lt(
              sql`COALESCE(${subscribersTable.confirmationSentAt}, ${subscribersTable.createdAt})`,
              cutoff,
            ),
          ),
        )
        .returning({ id: subscribersTable.id });
      if (deleted.length > 0) {
        logger.info(
          { count: deleted.length, ttlDays: SUBSCRIBERS_PENDING_TTL_DAYS },
          "Pruned stale pending subscribers",
        );
      }
    } catch (err) {
      logger.error({ err }, "subscribers pending-cleanup tick failed");
    } finally {
      pendingCleanupRunning = false;
    }
  }
  const pendingCleanupInitial = setTimeout(
    pendingCleanupTick,
    SUBSCRIBERS_PENDING_CLEANUP_INITIAL_DELAY_MS,
  );
  const pendingCleanupInterval = setInterval(
    pendingCleanupTick,
    SUBSCRIBERS_PENDING_CLEANUP_INTERVAL_MS,
  );

  return {
    stop() {
      stopping = true;
      clearTimeout(initial);
      clearInterval(interval);
      clearTimeout(reconcileInitial);
      clearInterval(reconcileInterval);
      clearTimeout(pendingCleanupInitial);
      clearInterval(pendingCleanupInterval);
    },
  };
}
