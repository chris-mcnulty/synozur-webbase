import { Router, type IRouter } from "express";
import { z } from "zod";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { db, commentsTable, postsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { audit } from "../../lib/audit";
import { sendCommentApprovedEmail, sendCommentReplyEmail } from "../../lib/email";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const ListQuery = z.object({
  status: z.enum(["pending", "approved", "spam", "deleted"]).optional(),
  postId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  "/cms/comments",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const { status, postId, page, pageSize } = parsed.data;
    const filters = [];
    if (status) filters.push(eq(commentsTable.status, status));
    if (postId) filters.push(eq(commentsTable.postId, postId));
    const where = filters.length ? and(...filters) : undefined;
    const offset = (page - 1) * pageSize;
    const [items, totalRow] = await Promise.all([
      db
        .select()
        .from(commentsTable)
        .where(where)
        .orderBy(desc(commentsTable.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ c: sql<number>`count(*)::int` }).from(commentsTable).where(where),
    ]);
    res.json({ items, page, pageSize, total: totalRow[0]?.c ?? 0 });
  },
);

// `notify` is an optional per-action flag. It defaults to `true` on approve
// (only effective if the commenter opted in at submission time) and to
// `false` for reject/spam/delete. Moderators can flip the flag in the UI
// when they want to silently approve, e.g. after an edit.
const Action = z.object({
  // "pending" restores a spam-flagged comment to pending for re-review.
  action: z.enum(["approve", "reject", "spam", "delete", "pending"]),
  notify: z.boolean().optional(),
});

router.post(
  "/cms/comments/:id/moderate",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = Action.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const newStatus =
      parsed.data.action === "approve"
        ? "approved"
        : parsed.data.action === "reject"
          ? "deleted"
          : parsed.data.action === "spam"
            ? "spam"
            : parsed.data.action === "pending"
              ? "pending"
              : "deleted";

    const existing = await db.query.commentsTable.findFirst({
      where: eq(commentsTable.id, String(req.params.id)),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const wasApproved = existing.status === "approved";
    const willApprove = newStatus === "approved";
    const shouldNotify =
      parsed.data.action === "approve" &&
      (parsed.data.notify ?? true) &&
      existing.notifyOnApproval &&
      !existing.notifiedApprovedAt &&
      !wasApproved &&
      willApprove &&
      existing.authorEmail.trim() !== "";

    const [row] = await db
      .update(commentsTable)
      .set({
        status: newStatus,
        moderatedBy: req.authedUser!.id,
        moderatedAt: new Date(),
      })
      .where(eq(commentsTable.id, String(req.params.id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (shouldNotify) {
      void (async () => {
        try {
          const post = await db.query.postsTable.findFirst({
            where: eq(postsTable.id, row.postId),
          });
          if (!post) return;
          await sendCommentApprovedEmail({
            to: row.authorEmail,
            commenterName: row.authorName,
            postTitle: post.title,
            postSlug: post.slug,
            commentId: row.id,
            bodyText: row.bodyText,
          });
          // Stamp notifiedApprovedAt only after a successful send so that a
          // failed delivery does not silently block future retry attempts.
          await db
            .update(commentsTable)
            .set({ notifiedApprovedAt: new Date() })
            .where(eq(commentsTable.id, row.id));
        } catch (err) {
          logger.warn({ err }, "comment approval notification failed");
        }
      })();
    }

    // #53: when a reply is approved for the first time, notify the top-level
    // ancestor's author if they opted in — unless the reply author is the
    // same person (self-reply guard). We resolve the ancestor so multi-level
    // threads still notify the original commenter, not an intermediate author.
    if (!wasApproved && willApprove && row.parentCommentId) {
      void (async () => {
        try {
          let ancestor = await db.query.commentsTable.findFirst({
            where: eq(commentsTable.id, row.parentCommentId!),
          });
          while (ancestor?.parentCommentId) {
            const next = await db.query.commentsTable.findFirst({
              where: eq(commentsTable.id, ancestor.parentCommentId),
            });
            if (!next) break;
            ancestor = next;
          }
          if (
            ancestor &&
            ancestor.notifyOnReply &&
            ancestor.authorEmail &&
            ancestor.authorEmail.trim() !== "" &&
            ancestor.authorEmail.toLowerCase() !== row.authorEmail.toLowerCase()
          ) {
            const post = await db.query.postsTable.findFirst({
              where: eq(postsTable.id, row.postId),
            });
            if (!post) return;
            await sendCommentReplyEmail({
              to: ancestor.authorEmail,
              parentCommenterName: ancestor.authorName,
              replyAuthorName: row.authorName,
              postTitle: post.title,
              postSlug: post.slug,
              parentCommentId: ancestor.id,
              replyCommentId: row.id,
              replyBodyText: row.bodyText,
            });
          }
        } catch (err) {
          logger.warn({ err }, "comment reply notification failed");
        }
      })();
    }

    await audit({
      actorId: req.authedUser!.id,
      action: `comment.${parsed.data.action}`,
      entity: "comment",
      entityId: row.id,
    });
    res.json(row);
  },
);

// #54: Bulk delete spam comments. Only deletes comments that are currently
// in `spam` status so this endpoint cannot be used to mass-delete arbitrary
// comments.
const BulkDeleteBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

router.post(
  "/cms/comments/bulk-delete-spam",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    const parsed = BulkDeleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { ids } = parsed.data;
    const deleted = await db
      .delete(commentsTable)
      .where(and(inArray(commentsTable.id, ids), eq(commentsTable.status, "spam")))
      .returning({ id: commentsTable.id });
    await audit({
      actorId: req.authedUser!.id,
      action: "comment.bulk_delete_spam",
      entity: "comment",
      entityId: ids.join(","),
    });
    res.json({ deleted: deleted.map((r) => r.id) });
  },
);

export default router;
