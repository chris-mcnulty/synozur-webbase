import { Router, type IRouter } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  notFoundLogsTable,
  wixRedirectsTable,
  type NotFoundLog,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import {
  invalidateRedirectCache,
  normalizePath as normalizeRedirectPath,
} from "../lib/wixRedirects";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];

function serialize(row: NotFoundLog) {
  return {
    id: row.id,
    path: row.path,
    normalizedPath: row.normalizedPath,
    hitCount: row.hitCount,
    lastReferrer: row.lastReferrer,
    lastUserAgent: row.lastUserAgent,
    resolved: row.resolved,
    notes: row.notes,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ListQuery = z.object({
  resolved: z.enum(["true", "false", "all"]).optional(),
  sort: z.enum(["hits", "recent"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get("/cms/not-found-logs", ...adminGuard, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const limit = parsed.data.limit ?? 500;
  const filter = parsed.data.resolved ?? "false";
  const sort = parsed.data.sort ?? "hits";

  const where =
    filter === "all"
      ? undefined
      : eq(notFoundLogsTable.resolved, filter === "true");

  const orderBy =
    sort === "recent"
      ? [desc(notFoundLogsTable.lastSeenAt), desc(notFoundLogsTable.hitCount)]
      : [desc(notFoundLogsTable.hitCount), desc(notFoundLogsTable.lastSeenAt)];

  const rows = await db
    .select()
    .from(notFoundLogsTable)
    .where(where ?? sql`true`)
    .orderBy(...orderBy)
    .limit(limit);

  res.json({ items: rows.map(serialize) });
});

const PatchBody = z.object({
  resolved: z.boolean().optional(),
  notes: z.string().max(500).nullish(),
});

router.patch("/cms/not-found-logs/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.notFoundLogsTable.findFirst({
    where: eq(notFoundLogsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = PatchBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof notFoundLogsTable.$inferInsert> = {};
  if (parsed.data.resolved !== undefined) updates.resolved = parsed.data.resolved;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;

  const [row] = await db
    .update(notFoundLogsTable)
    .set(updates)
    .where(eq(notFoundLogsTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "not_found_log.update",
    entity: "not_found_log",
    entityId: id,
  });
  res.json(serialize(row));
});

router.delete("/cms/not-found-logs/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.notFoundLogsTable.findFirst({
    where: eq(notFoundLogsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(notFoundLogsTable).where(eq(notFoundLogsTable.id, id));
  await audit({
    actorId: req.authedUser!.id,
    action: "not_found_log.delete",
    entity: "not_found_log",
    entityId: id,
  });
  res.status(204).end();
});

const RedirectBody = z.object({
  targetPath: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((v) => v.startsWith("/"), { message: "Path must start with /" }),
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
  notes: z.string().max(500).nullish(),
});

/**
 * Convenience flow for the admin UI: create a Wix redirect from this 404
 * row's path and mark the log row resolved in one round-trip.
 */
router.post(
  "/cms/not-found-logs/:id/redirect",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const log = await db.query.notFoundLogsTable.findFirst({
      where: eq(notFoundLogsTable.id, id),
    });
    if (!log) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = RedirectBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const sourcePath = normalizeRedirectPath(log.path);
    const conflict = await db.query.wixRedirectsTable.findFirst({
      where: eq(wixRedirectsTable.sourcePath, sourcePath),
    });
    if (conflict) {
      res
        .status(409)
        .json({ error: "A redirect for this source path already exists" });
      return;
    }
    const { redirect, updatedLog } = await db.transaction(async (tx) => {
      const [insertedRedirect] = await tx
        .insert(wixRedirectsTable)
        .values({
          sourcePath,
          targetPath: parsed.data.targetPath,
          statusCode: parsed.data.statusCode ?? 301,
          active: true,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      const [updated] = await tx
        .update(notFoundLogsTable)
        .set({ resolved: true })
        .where(eq(notFoundLogsTable.id, id))
        .returning();
      return { redirect: insertedRedirect, updatedLog: updated };
    });
    // Cache invalidation must happen after the transaction commits, otherwise
    // a concurrent request could re-warm the cache from the pre-commit state.
    invalidateRedirectCache();

    await audit({
      actorId: req.authedUser!.id,
      action: "not_found_log.create_redirect",
      entity: "wix_redirect",
      entityId: redirect.id,
    });

    res.status(201).json({
      redirect: {
        id: redirect.id,
        sourcePath: redirect.sourcePath,
        targetPath: redirect.targetPath,
        statusCode: redirect.statusCode,
      },
      log: serialize(updatedLog),
    });
  },
);

router.delete("/cms/not-found-logs", ...adminGuard, async (req, res) => {
  const parsed = z
    .object({ resolved: z.enum(["true", "false", "all"]).optional() })
    .safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  const filter = parsed.data.resolved ?? "true";
  const where =
    filter === "all"
      ? undefined
      : eq(notFoundLogsTable.resolved, filter === "true");
  const result = await db.delete(notFoundLogsTable).where(where ?? sql`true`);
  await audit({
    actorId: req.authedUser!.id,
    action: "not_found_log.bulk_delete",
    entity: "not_found_log",
    entityId: filter,
  });
  res.json({ ok: true, deleted: result.rowCount ?? 0 });
});

export default router;
