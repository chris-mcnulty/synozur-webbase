import { Router, type IRouter } from "express";
import { z } from "zod";
import { desc, eq, sql, and } from "drizzle-orm";
import { db, commentsTable, postsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { audit } from "../../lib/audit";
import { sendCommentApprovedEmail } from "../../lib/email";
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
  action: z.enum(["approve", "reject", "spam", "delete"]),
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
        ...(shouldNotify ? { notifiedApprovedAt: new Date() } : {}),
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
        } catch (err) {
          logger.warn({ err }, "comment approval notification failed");
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

export default router;
