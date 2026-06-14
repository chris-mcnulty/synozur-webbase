import { and, eq, lte, isNull, lt, not, or, like, sql } from "drizzle-orm";
import { db, postsTable, subscribersTable, auditLogTable, siteSettingsTable, pendingEmailRemindersTable } from "@workspace/db";
import { audit } from "./audit";
import { sendEventReminderEmail } from "./email";
import { reconcileAllEngagementDocuments } from "./portalDocumentIndexer";
import { flushPortalDocumentNotifications } from "./portalDocumentNotifications";
import { reindexEditorialSourceSafe } from "./ai/reindexHook";
import { runAutoStopSweep } from "./experimentsAutoStop";
import { runSeoCoverageScan } from "./seoCoverage";
import { invalidateActiveExperimentsCache } from "../routes/experiments";
import type { Logger } from "pino";

const TICK_INTERVAL_MS = 60_000;
const PORTAL_DOCS_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PORTAL_DOCS_RECONCILE_INITIAL_DELAY_MS = 10 * 60 * 1000;
// #242 — customer publish-notification flush. Runs roughly every minute
// so a freshly-published row is observed quickly; the THROTTLE_MS
// inside the flusher coalesces back-to-back publishes into a single
// digest per engagement.
const PORTAL_DOCS_NOTIFY_INTERVAL_MS = 60_000;
const PORTAL_DOCS_NOTIFY_INITIAL_DELAY_MS = 15_000;
const SUBSCRIBERS_PENDING_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUBSCRIBERS_PENDING_CLEANUP_INITIAL_DELAY_MS = 15 * 60 * 1000;
const SUBSCRIBERS_PENDING_TTL_DAYS = 30;
const AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUDIT_PRUNE_INITIAL_DELAY_MS = 15 * 60 * 1000;
// Experiment auto-stop sweep runs hourly so a configured duration or
// significance threshold is honored within an hour of crossing.
const EXPERIMENT_AUTOSTOP_INTERVAL_MS = 60 * 60 * 1000;
const EXPERIMENT_AUTOSTOP_INITIAL_DELAY_MS = 5 * 60 * 1000;
// #160 — daily Search Console / Bing index-coverage scan. Delayed well
// past boot so startup migrations and the first sitemap build settle
// first; the scanner no-ops cheaply when no provider creds are set.
const SEO_COVERAGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SEO_COVERAGE_INITIAL_DELAY_MS = 20 * 60 * 1000;
// Auth/oauth/session events are kept for 5 years regardless of the admin's
// retention setting — these are the rows compliance teams actually need.
const AUTH_RETENTION_DAYS = 365 * 5;

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
        // Auto-publish from the worker must also refresh the Ask Synozur
        // corpus so the post becomes answerable without a manual rebuild.
        await reindexEditorialSourceSafe("post", post.id, logger);
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

  // #242 — flush queued customer notifications for newly-published portal
  // documents. Throttled inside the flusher so back-to-back publishes
  // coalesce into a single per-engagement digest.
  let notifyRunning = false;
  async function notifyTick() {
    if (stopping || notifyRunning) return;
    notifyRunning = true;
    try {
      const flushed = await flushPortalDocumentNotifications();
      if (flushed.engagementsClaimed > 0 || flushed.emailsFailed > 0) {
        logger.info(
          flushed,
          "portal-document publish notifications flushed",
        );
      }
    } catch (err) {
      logger.error({ err }, "portal-document notification tick failed");
    } finally {
      notifyRunning = false;
    }
  }
  const notifyInitial = setTimeout(notifyTick, PORTAL_DOCS_NOTIFY_INITIAL_DELAY_MS);
  const notifyInterval = setInterval(notifyTick, PORTAL_DOCS_NOTIFY_INTERVAL_MS);

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

  // #169 — Daily audit-log prune. Deletes rows older than the admin-configured
  // retention window (default 365 days), but keeps `auth.*`, `oauth.*`, and
  // `session.*` actions for 5 years regardless so compliance / forensics
  // queries still have a long tail to work with.
  let auditPruneRunning = false;
  async function auditPruneTick() {
    if (stopping || auditPruneRunning) return;
    auditPruneRunning = true;
    try {
      const settings = await db.select().from(siteSettingsTable).limit(1);
      const retentionDays = settings[0]?.auditLogRetentionDays ?? 365;
      const generalCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const authCutoff = new Date(Date.now() - AUTH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      const isAuthLike = or(
        like(auditLogTable.action, "auth.%"),
        like(auditLogTable.action, "oauth.%"),
        like(auditLogTable.action, "session.%"),
      );

      // Non-auth rows older than the general cutoff.
      const generalDeleted = await db
        .delete(auditLogTable)
        .where(
          and(
            lt(auditLogTable.at, generalCutoff),
            not(isAuthLike ?? sql`false`),
          ),
        )
        .returning({ id: auditLogTable.id });

      // Auth/oauth/session rows older than the 5-year cutoff.
      const authDeleted = await db
        .delete(auditLogTable)
        .where(
          and(
            lt(auditLogTable.at, authCutoff),
            isAuthLike,
          ),
        )
        .returning({ id: auditLogTable.id });

      const total = generalDeleted.length + authDeleted.length;
      if (total > 0) {
        logger.info(
          {
            general: generalDeleted.length,
            auth: authDeleted.length,
            retentionDays,
            authRetentionDays: AUTH_RETENTION_DAYS,
          },
          "audit-log prune: deleted expired rows",
        );
      }
    } catch (err) {
      logger.error({ err }, "audit-log prune tick failed");
    } finally {
      auditPruneRunning = false;
    }
  }
  const auditPruneInitial = setTimeout(auditPruneTick, AUDIT_PRUNE_INITIAL_DELAY_MS);
  const auditPruneInterval = setInterval(auditPruneTick, AUDIT_PRUNE_INTERVAL_MS);

  let autoStopRunning = false;
  async function autoStopTick() {
    if (stopping || autoStopRunning) return;
    autoStopRunning = true;
    try {
      const { stopped } = await runAutoStopSweep({
        invalidateCache: invalidateActiveExperimentsCache,
        audit,
      });
      if (stopped > 0) {
        logger.info({ stopped }, "experiment auto-stop sweep ended experiments");
      }
    } catch (err) {
      logger.error({ err }, "experiment auto-stop tick failed");
    } finally {
      autoStopRunning = false;
    }
  }
  const autoStopInitial = setTimeout(
    autoStopTick,
    EXPERIMENT_AUTOSTOP_INITIAL_DELAY_MS,
  );
  const autoStopInterval = setInterval(
    autoStopTick,
    EXPERIMENT_AUTOSTOP_INTERVAL_MS,
  );

  // #160 — daily SEO index-coverage scan.
  let seoCoverageRunning = false;
  async function seoCoverageTick() {
    if (stopping || seoCoverageRunning) return;
    seoCoverageRunning = true;
    try {
      const result = await runSeoCoverageScan("scheduled");
      if (!result.skipped) {
        logger.info(result, "seo-coverage daily scan complete");
      }
    } catch (err) {
      logger.error({ err }, "seo-coverage daily scan tick failed");
    } finally {
      seoCoverageRunning = false;
    }
  }
  const seoCoverageInitial = setTimeout(
    seoCoverageTick,
    SEO_COVERAGE_INITIAL_DELAY_MS,
  );
  const seoCoverageInterval = setInterval(
    seoCoverageTick,
    SEO_COVERAGE_INTERVAL_MS,
  );

  // #332 — drain pending_email_reminders every 5 minutes. Sends event
  // reminder emails 24 hours before the event starts. Max 5 attempts per row;
  // after that the row is left unsent for admin review.
  const REMINDER_DRAIN_INTERVAL_MS = 5 * 60_000;
  const REMINDER_DRAIN_INITIAL_DELAY_MS = 30_000;
  const REMINDER_MAX_ATTEMPTS = 5;

  let reminderDrainRunning = false;
  async function reminderDrainTick() {
    if (stopping || reminderDrainRunning) return;
    reminderDrainRunning = true;
    try {
      const now = new Date();
      const due = await db
        .select()
        .from(pendingEmailRemindersTable)
        .where(
          and(
            lte(pendingEmailRemindersTable.scheduledFor, now),
            isNull(pendingEmailRemindersTable.sentAt),
            lt(pendingEmailRemindersTable.attempts, REMINDER_MAX_ATTEMPTS),
          ),
        )
        .limit(20);

      for (const row of due) {
        try {
          if (row.kind === "event_reminder") {
            const p = (row.payload ?? {}) as Record<string, string | null>;
            await sendEventReminderEmail({
              to: row.recipientEmail,
              firstName: row.recipientName ?? row.recipientEmail.split("@")[0] ?? "there",
              eventTitle: p["eventTitle"] ?? "Upcoming event",
              eventDate: p["eventDate"] ?? "",
              eventLocation: p["eventLocation"] ?? null,
              eventSlug: p["eventSlug"] ?? "",
            });
          }
          await db
            .update(pendingEmailRemindersTable)
            .set({ sentAt: now })
            .where(eq(pendingEmailRemindersTable.id, row.id));
          logger.info(
            { kind: row.kind, id: row.id, to: row.recipientEmail },
            "pending email reminder sent",
          );
        } catch (err) {
          await db
            .update(pendingEmailRemindersTable)
            .set({ attempts: row.attempts + 1 })
            .where(eq(pendingEmailRemindersTable.id, row.id));
          logger.warn(
            { err, kind: row.kind, id: row.id, attempts: row.attempts + 1 },
            "pending email reminder send failed",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "reminder-drain tick failed");
    } finally {
      reminderDrainRunning = false;
    }
  }
  const reminderDrainInitial = setTimeout(
    reminderDrainTick,
    REMINDER_DRAIN_INITIAL_DELAY_MS,
  );
  const reminderDrainInterval = setInterval(
    reminderDrainTick,
    REMINDER_DRAIN_INTERVAL_MS,
  );

  return {
    stop() {
      stopping = true;
      clearTimeout(initial);
      clearInterval(interval);
      clearTimeout(seoCoverageInitial);
      clearInterval(seoCoverageInterval);
      clearTimeout(reconcileInitial);
      clearInterval(reconcileInterval);
      clearTimeout(notifyInitial);
      clearInterval(notifyInterval);
      clearTimeout(pendingCleanupInitial);
      clearInterval(pendingCleanupInterval);
      clearTimeout(auditPruneInitial);
      clearInterval(auditPruneInterval);
      clearTimeout(autoStopInitial);
      clearInterval(autoStopInterval);
      clearTimeout(reminderDrainInitial);
      clearInterval(reminderDrainInterval);
    },
  };
}
