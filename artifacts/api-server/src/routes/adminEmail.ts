import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  emailEventsTable,
  emailMessagesTable,
} from "@workspace/db/schema";
import { requireCapability } from "../middlewares/auth";

// #221 — Admin read API powering /admin/email.
//
// GET /api/admin/email/messages — paginated list of recent sends with their
//                                 latest delivery status (denormalized on
//                                 the row, written by the webhook ingest).
// GET /api/admin/email/messages/:id/events — full event timeline for one send.

const router: IRouter = Router();

router.get(
  "/admin/email/messages",
  requireCapability("site.manage"),
  async (req, res) => {
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const template =
      typeof req.query["template"] === "string" && req.query["template"]
        ? req.query["template"]
        : undefined;
    const status =
      typeof req.query["status"] === "string" && req.query["status"]
        ? req.query["status"]
        : undefined;

    const baseQuery = db
      .select({
        id: emailMessagesTable.id,
        messageId: emailMessagesTable.messageId,
        toEmail: emailMessagesTable.toEmail,
        subject: emailMessagesTable.subject,
        template: emailMessagesTable.template,
        latestEvent: emailMessagesTable.latestEvent,
        latestEventAt: emailMessagesTable.latestEventAt,
        createdAt: emailMessagesTable.createdAt,
      })
      .from(emailMessagesTable)
      .$dynamic();

    const filters = [] as ReturnType<typeof sql>[];
    if (template) filters.push(sql`${emailMessagesTable.template} = ${template}`);
    if (status === "pending") {
      filters.push(sql`${emailMessagesTable.latestEvent} IS NULL`);
    } else if (status) {
      filters.push(sql`${emailMessagesTable.latestEvent} = ${status}`);
    }

    const filtered =
      filters.length > 0
        ? baseQuery.where(
            sql.join(filters, sql.raw(" AND ")),
          )
        : baseQuery;

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailMessagesTable)
      .$dynamic();
    const filteredCount =
      filters.length > 0
        ? countQuery.where(sql.join(filters, sql.raw(" AND ")))
        : countQuery;

    const [rows, totalRow] = await Promise.all([
      filtered
        .orderBy(desc(emailMessagesTable.createdAt))
        .limit(limit)
        .offset(offset),
      filteredCount.then((r) => r[0]?.count ?? 0),
    ]);

    res.json({
      total: totalRow,
      items: rows.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        toEmail: r.toEmail,
        subject: r.subject,
        template: r.template,
        latestEvent: r.latestEvent,
        latestEventAt: r.latestEventAt
          ? r.latestEventAt.toISOString()
          : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
);

router.get(
  "/admin/email/templates",
  requireCapability("site.manage"),
  async (_req, res) => {
    const rows = await db
      .selectDistinct({ template: emailMessagesTable.template })
      .from(emailMessagesTable);
    res.json(rows.map((r) => r.template).sort());
  },
);

router.get(
  "/admin/email/messages/:id/events",
  requireCapability("site.manage"),
  async (req, res) => {
    const id = String(req.params["id"] ?? "");
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const rows = await db
      .select({
        id: emailEventsTable.id,
        sgMessageId: emailEventsTable.sgMessageId,
        event: emailEventsTable.event,
        emailAddr: emailEventsTable.emailAddr,
        reason: emailEventsTable.reason,
        eventAt: emailEventsTable.eventAt,
        receivedAt: emailEventsTable.receivedAt,
      })
      .from(emailEventsTable)
      .where(eq(emailEventsTable.emailMessageId, id))
      .orderBy(desc(emailEventsTable.eventAt));
    res.json(
      rows.map((r) => ({
        id: r.id,
        sgMessageId: r.sgMessageId,
        event: r.event,
        emailAddr: r.emailAddr,
        reason: r.reason,
        eventAt: r.eventAt.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
      })),
    );
  },
);

export default router;
