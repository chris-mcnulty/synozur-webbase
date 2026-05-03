import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, like, or, lt, sql } from "drizzle-orm";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

const router: IRouter = Router();

const QuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  actorEmail: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  actionPrefix: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type Filters = z.infer<typeof QuerySchema>;

interface CursorShape {
  at: string;
  id: string;
}

function decodeCursor(raw: string | undefined): CursorShape | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<CursorShape>;
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(c: CursorShape): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

async function buildWhere(f: Filters) {
  const conditions = [];
  if (f.actorId) conditions.push(eq(auditLogTable.actorId, f.actorId));
  if (f.entity) conditions.push(eq(auditLogTable.entity, f.entity));
  if (f.entityId) conditions.push(eq(auditLogTable.entityId, f.entityId));
  if (f.actionPrefix) {
    // Escape LIKE wildcards in user-supplied prefix.
    const safe = f.actionPrefix.replace(/[\\%_]/g, "\\$&");
    conditions.push(like(auditLogTable.action, `${safe}%`));
  }
  if (f.from) conditions.push(gte(auditLogTable.at, new Date(f.from)));
  if (f.to) conditions.push(lte(auditLogTable.at, new Date(f.to)));
  if (f.actorEmail) {
    // Resolve email → user ids; fall back to "no rows" sentinel if no match.
    const matches = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(like(usersTable.email, `%${f.actorEmail.replace(/[\\%_]/g, "\\$&")}%`));
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) {
      conditions.push(sql`false`);
    } else {
      conditions.push(
        or(...ids.map((id) => eq(auditLogTable.actorId, id))) ?? sql`false`,
      );
    }
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function fetchRows(f: Filters, limit: number, cursor: CursorShape | null) {
  const where = await buildWhere(f);
  // Cursor: rows older than (at, id) tuple.
  const cursorCond = cursor
    ? or(
        lt(auditLogTable.at, new Date(cursor.at)),
        and(
          eq(auditLogTable.at, new Date(cursor.at)),
          lt(auditLogTable.id, cursor.id),
        ),
      )
    : undefined;
  const finalWhere =
    where && cursorCond ? and(where, cursorCond) : (cursorCond ?? where);

  const rows = await db
    .select({
      id: auditLogTable.id,
      actorId: auditLogTable.actorId,
      action: auditLogTable.action,
      entity: auditLogTable.entity,
      entityId: auditLogTable.entityId,
      diffJson: auditLogTable.diffJson,
      at: auditLogTable.at,
      actorEmail: usersTable.email,
      actorDisplayName: usersTable.displayName,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.actorId, usersTable.id))
    .where(finalWhere)
    .orderBy(desc(auditLogTable.at), desc(auditLogTable.id))
    .limit(limit + 1);
  return rows;
}

// Authz model:
// - Global feed (no `entity`+`entityId`) is admin-only — it can surface
//   sensitive cross-cutting events (auth failures, role grants, OAuth
//   client changes) that non-admins shouldn't browse freely.
// - Entity-scoped queries (both `entity` and `entityId` provided) are open
//   to any CMS role so the per-entity ActivityTab on edit pages works for
//   editor / author / contributor users without a 403.
router.get(
  "/cms/audit-log",
  requireAuth,
  requireRole("admin", "editor", "author", "contributor"),
  async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const f = parsed.data;
    const isEntityScoped = Boolean(f.entity && f.entityId);
    const isAdmin = req.authedUser?.roles.includes("admin") ?? false;
    if (!isEntityScoped && !isAdmin) {
      res.status(403).json({
        error:
          "Global audit-log queries require admin role. Provide both `entity` and `entityId` for the per-entity activity feed.",
      });
      return;
    }
    const limit = f.limit ?? 50;
    const cursor = decodeCursor(f.cursor);

    try {
      const rows = await fetchRows(f, limit, cursor);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ at: last.at.toISOString(), id: last.id }) : null;

      res.json({
        items: page.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          actorEmail: r.actorEmail,
          actorDisplayName: r.actorDisplayName,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          diff: r.diffJson ?? null,
          at: r.at.toISOString(),
        })),
        nextCursor,
      });
    } catch (err) {
      req.log?.error({ err }, "audit-log query failed");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// CSV export stays admin-only: this is the compliance / legal-handoff path,
// and a 10k-row dump is a big enough surface that we want it gated tightly.
router.get(
  "/cms/audit-log.csv",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const f = parsed.data;
    // CSV export is intentionally uncapped vs the JSON page size, but we
    // hard-cap at 10k rows so a runaway export can't OOM the server.
    const MAX_CSV = 10_000;
    const rows = await fetchRows(f, MAX_CSV, null);
    const page = rows.length > MAX_CSV ? rows.slice(0, MAX_CSV) : rows;

    const headers = [
      "at",
      "actor_id",
      "actor_email",
      "actor_display_name",
      "action",
      "entity",
      "entity_id",
      "diff_json",
    ];

    function escape(v: unknown): string {
      if (v == null) return "";
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }

    const lines = [headers.join(",")];
    for (const r of page) {
      lines.push(
        [
          r.at.toISOString(),
          r.actorId ?? "",
          r.actorEmail ?? "",
          r.actorDisplayName ?? "",
          r.action,
          r.entity,
          r.entityId ?? "",
          r.diffJson ? JSON.stringify(r.diffJson) : "",
        ]
          .map(escape)
          .join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(lines.join("\n"));
  },
);

export default router;
