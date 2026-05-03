import type { Response } from "express";

/**
 * Shared helper for HTTP 410 Gone responses on public artifact loaders.
 *
 * #162 / launch-readiness L13. When a published artifact is unpublished
 * (status === "archived" or unpublishedAt has passed) we want Google to
 * de-index it promptly. The right signal is HTTP 410 Gone, not a 200 with
 * `noindex` and not a 404 (which Google treats as transient).
 *
 * The body is intentionally JSON + a friendly message rather than blank —
 * the SPA + social bots both consume this and a blank body shows up as a
 * raw "410 Gone" page in unfurl previews.
 */

export interface UnpublishableRow {
  status?: string | null;
  unpublishedAt?: Date | null;
  active?: boolean | null;
}

/**
 * Returns true when a row should be treated as permanently gone:
 * either explicitly archived, or past its unpublish window.
 *
 * Soft-delete (deletedAt) is intentionally NOT treated as "gone" here —
 * a soft-delete is an admin-only signal (the row may have been deleted in
 * error and could be restored), so those continue to 404. Use isGone() at
 * call sites that have already filtered on `deletedAt is null`.
 */
export function isGone(row: UnpublishableRow, now: Date = new Date()): boolean {
  if (row.status === "archived") return true;
  if (row.unpublishedAt && row.unpublishedAt <= now) return true;
  return false;
}

/**
 * Send the canonical 410 Gone response. The body is JSON because every
 * caller is an `/api/...` route consumed by the SPA / social bot renderer;
 * the SPA renders the friendly message on the corresponding page.
 */
export function sendGone(
  res: Response,
  kind: string = "page",
): void {
  res.status(410).json({
    error: "Gone",
    code: "gone",
    message: `This ${kind} is no longer available — try the latest at the section index.`,
  });
}
