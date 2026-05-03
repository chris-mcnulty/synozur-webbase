// #242 — Customer notification flusher for newly-published portal documents.
//
// When an account manager flips `portal_documents.published_at` from null
// to a timestamp, customer portal users with access to that engagement
// should hear about it via email. Two requirements interact here:
//
//   1. Coalesce — multiple publishes in quick succession should produce
//      a single digest email, not one email per file.
//   2. Throttle — at most one email per engagement per ~15 minutes.
//
// Implementation strategy:
//
//   - Each newly-published row carries `notified_at = NULL`. The flusher's
//     work queue is rows where `published_at IS NOT NULL AND notified_at
//     IS NULL AND deleted_at IS NULL`. (Republish resets the flag in the
//     publish route.)
//   - Per engagement, we wait until the *oldest* unsent row has been
//     pending for at least `COALESCE_WINDOW_MS`. While the window is open,
//     additional publishes pile onto the same digest. This is what stops
//     the first publish in a burst from going out alone.
//   - The claim itself is a single `UPDATE ... RETURNING` that, in one
//     statement, transitions all matching rows to `notified_at = now`
//     iff no row in the same engagement was notified within
//     `THROTTLE_MS`. This makes claiming atomic across overlapping
//     scheduler ticks and request-time kicks: only one caller observes
//     the rows as claimed, the rest get an empty result and skip.
//   - On a successful claim we then send the digest to every member of
//     the owning client organization and write a `portal_document.notify`
//     audit entry per recipient. If every send hard-fails (network, etc.)
//     we revert the claim so the next tick can retry; if at least one
//     send succeeded or skipped (EMAIL_DISABLED / SendGrid not
//     configured), the rows stay claimed to avoid duplicate sends.
//
// The flusher is idempotent and safe to run on a short interval.

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  clientOrganizationUsersTable,
  engagementsTable,
  portalDocumentsTable,
  usersTable,
} from "@workspace/db";
import { audit } from "./audit";
import { sendPortalDocumentsPublishedEmail } from "./email";
import { logger } from "./logger";

// Per-engagement throttle window: minimum gap between digest emails for
// the same engagement. (#242 spec: "~15 minutes".)
const THROTTLE_MS = 15 * 60 * 1000;
// Coalesce window: how long we let pending publishes accumulate before
// flushing the digest. Two minutes is short enough that customers see
// new deliverables promptly, long enough that bursty publish sessions
// fold into a single email.
const COALESCE_WINDOW_MS = 2 * 60 * 1000;

export interface FlushResult {
  engagementsConsidered: number;
  engagementsClaimed: number;
  engagementsThrottledOrCoalescing: number;
  emailsSent: number;
  emailsFailed: number;
  documentsNotified: number;
}

export async function flushPortalDocumentNotifications(
  now: Date = new Date(),
): Promise<FlushResult> {
  const result: FlushResult = {
    engagementsConsidered: 0,
    engagementsClaimed: 0,
    engagementsThrottledOrCoalescing: 0,
    emailsSent: 0,
    emailsFailed: 0,
    documentsNotified: 0,
  };

  const coalesceCutoff = new Date(now.getTime() - COALESCE_WINDOW_MS);
  const throttleCutoff = new Date(now.getTime() - THROTTLE_MS);

  // Engagements whose oldest pending publish is older than the coalesce
  // window — i.e. the burst has settled and we're ready to flush.
  // Engagements still inside their coalesce window are deliberately
  // skipped this tick; they'll be picked up by the next one.
  const candidates = await db
    .select({ engagementId: portalDocumentsTable.engagementId })
    .from(portalDocumentsTable)
    .where(
      and(
        isNotNull(portalDocumentsTable.publishedAt),
        isNull(portalDocumentsTable.notifiedAt),
        isNull(portalDocumentsTable.deletedAt),
      ),
    )
    .groupBy(portalDocumentsTable.engagementId)
    .having(sql`MIN(${portalDocumentsTable.publishedAt}) <= ${coalesceCutoff}`);

  result.engagementsConsidered = candidates.length;
  if (candidates.length === 0) return result;

  for (const { engagementId } of candidates) {
    try {
      // Atomic claim: transition every pending row for this engagement
      // to `notified_at = now`, but only if no other row in the same
      // engagement has been notified inside the throttle window. The
      // NOT EXISTS subquery is evaluated by the same UPDATE so two
      // concurrent flushers race here harmlessly — the loser sees zero
      // rows updated and falls through to the next iteration.
      const claimed = await db
        .update(portalDocumentsTable)
        .set({ notifiedAt: now })
        .where(
          and(
            eq(portalDocumentsTable.engagementId, engagementId),
            isNotNull(portalDocumentsTable.publishedAt),
            isNull(portalDocumentsTable.notifiedAt),
            isNull(portalDocumentsTable.deletedAt),
            sql`NOT EXISTS (
              SELECT 1 FROM portal_documents pd2
              WHERE pd2.engagement_id = ${engagementId}
                AND pd2.notified_at IS NOT NULL
                AND pd2.notified_at > ${throttleCutoff}
            )`,
          ),
        )
        .returning({
          id: portalDocumentsTable.id,
          filename: portalDocumentsTable.filename,
        });

      if (claimed.length === 0) {
        // Either throttled, or another worker claimed the rows first.
        result.engagementsThrottledOrCoalescing++;
        continue;
      }

      const engagement = await db.query.engagementsTable.findFirst({
        where: eq(engagementsTable.id, engagementId),
      });
      if (!engagement || engagement.deletedAt) {
        // Engagement vanished under us. Rows are already claimed
        // (notified_at set), so they won't be retried. No email goes out.
        result.engagementsClaimed++;
        result.documentsNotified += claimed.length;
        continue;
      }

      // Recipients: every member of the owning client organization.
      const recipients = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
        })
        .from(clientOrganizationUsersTable)
        .innerJoin(
          usersTable,
          eq(clientOrganizationUsersTable.userId, usersTable.id),
        )
        .where(
          eq(
            clientOrganizationUsersTable.clientOrganizationId,
            engagement.clientOrganizationId,
          ),
        );

      const filenames = claimed.map((r) => r.filename);
      const docIds = claimed.map((r) => r.id);

      let anyHandled = false;
      let allHardFailed = true;
      for (const recipient of recipients) {
        if (!recipient.email) continue;
        try {
          const sendResult = await sendPortalDocumentsPublishedEmail({
            to: recipient.email,
            recipientName: recipient.displayName,
            engagementTitle: engagement.title,
            filenames,
          });
          if (sendResult.status === "ok" || sendResult.status === "skipped") {
            anyHandled = true;
            allHardFailed = false;
            if (sendResult.status === "ok") result.emailsSent++;
            await audit({
              action: "portal_document.notify",
              entity: "engagement",
              entityId: engagementId,
              diff: {
                recipientUserId: recipient.id,
                recipientEmail: recipient.email,
                engagementTitle: engagement.title,
                documentIds: docIds,
                filenames,
                emailStatus: sendResult.status,
                messageId: sendResult.messageId ?? null,
              },
            });
          } else {
            result.emailsFailed++;
            logger.warn(
              {
                err: sendResult.error,
                engagementId,
                recipientUserId: recipient.id,
              },
              "portal-document publish notification send failed",
            );
            // Record the hard failure in the audit log so the admin
            // surface can flag dropped recipients for manual resend.
            // Without this, a single transient SendGrid error would
            // silently drop a customer from the digest. (#242)
            await audit({
              action: "portal_document.notify_failed",
              entity: "engagement",
              entityId: engagementId,
              diff: {
                recipientUserId: recipient.id,
                recipientEmail: recipient.email,
                engagementTitle: engagement.title,
                documentIds: docIds,
                filenames,
                error: sendResult.error,
              },
            });
          }
        } catch (err) {
          result.emailsFailed++;
          logger.error(
            { err, engagementId, recipientUserId: recipient.id },
            "portal-document publish notification threw",
          );
          await audit({
            action: "portal_document.notify_failed",
            entity: "engagement",
            entityId: engagementId,
            diff: {
              recipientUserId: recipient.id,
              recipientEmail: recipient.email,
              engagementTitle: engagement.title,
              documentIds: docIds,
              filenames,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }

      // No recipients at all — there's no one to email; keep the rows
      // claimed so we don't loop forever. Counts as "handled".
      if (recipients.length === 0) {
        anyHandled = true;
        allHardFailed = false;
      }

      if (!anyHandled && allHardFailed) {
        // Every recipient hard-failed. Revert the claim so the next
        // tick will retry. We're guarded by the throttle predicate
        // which is keyed off OTHER rows' notified_at, so reverting
        // these rows' notified_at to NULL is safe — no duplicate
        // email has gone out.
        await db
          .update(portalDocumentsTable)
          .set({ notifiedAt: null })
          .where(
            and(
              eq(portalDocumentsTable.engagementId, engagementId),
              inArray(portalDocumentsTable.id, docIds),
            ),
          );
        logger.warn(
          { engagementId, docIds },
          "portal-document notification claim reverted after all sends failed",
        );
        continue;
      }

      result.engagementsClaimed++;
      result.documentsNotified += docIds.length;
    } catch (err) {
      logger.error(
        { err, engagementId },
        "portal-document notification flush failed for engagement",
      );
    }
  }

  return result;
}
