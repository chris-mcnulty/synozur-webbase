import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, wixRedirectsTable, type WixRedirect } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { invalidateRedirectCache, normalizePath } from "../lib/wixRedirects";

const router: IRouter = Router();

const readGuard = [requireAuth];
const adminGuard = [requireAuth, requireRole("admin", "editor")];

function serialize(row: WixRedirect) {
  return {
    id: row.id,
    sourcePath: row.sourcePath,
    targetPath: row.targetPath,
    statusCode: row.statusCode,
    active: row.active,
    notes: row.notes,
    hitCount: row.hitCount,
    lastHitAt: row.lastHitAt ? row.lastHitAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const pathShape = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => v.startsWith("/"), { message: "Path must start with /" });

const CreateBody = z.object({
  sourcePath: pathShape,
  targetPath: pathShape,
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(500).nullish(),
});
const UpdateBody = CreateBody.partial();

router.get("/cms/wix-redirects", ...readGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(wixRedirectsTable)
    .orderBy(desc(wixRedirectsTable.updatedAt), asc(wixRedirectsTable.sourcePath));
  res.json({ items: rows.map(serialize) });
});

router.post("/cms/wix-redirects", ...adminGuard, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const source = normalizePath(d.sourcePath);
  const existing = await db.query.wixRedirectsTable.findFirst({
    where: eq(wixRedirectsTable.sourcePath, source),
  });
  if (existing) {
    res.status(409).json({ error: "A redirect for this source path already exists" });
    return;
  }
  const [row] = await db
    .insert(wixRedirectsTable)
    .values({
      sourcePath: source,
      targetPath: d.targetPath,
      statusCode: d.statusCode ?? 301,
      active: d.active ?? true,
      notes: d.notes ?? null,
    })
    .returning();
  invalidateRedirectCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "wix_redirect.create",
    entity: "wix_redirect",
    entityId: row.id,
  });
  res.status(201).json(serialize(row));
});

router.patch("/cms/wix-redirects/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.wixRedirectsTable.findFirst({
    where: eq(wixRedirectsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof wixRedirectsTable.$inferInsert> = {};
  if (d.sourcePath !== undefined) {
    const source = normalizePath(d.sourcePath);
    const conflict = await db.query.wixRedirectsTable.findFirst({
      where: and(
        eq(wixRedirectsTable.sourcePath, source),
        ne(wixRedirectsTable.id, id),
      ),
    });
    if (conflict) {
      res.status(409).json({ error: "A redirect for this source path already exists" });
      return;
    }
    updates.sourcePath = source;
  }
  if (d.targetPath !== undefined) updates.targetPath = d.targetPath;
  if (d.statusCode !== undefined) updates.statusCode = d.statusCode;
  if (d.active !== undefined) updates.active = d.active;
  if (d.notes !== undefined) updates.notes = d.notes ?? null;
  const [row] = await db
    .update(wixRedirectsTable)
    .set(updates)
    .where(eq(wixRedirectsTable.id, id))
    .returning();
  invalidateRedirectCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "wix_redirect.update",
    entity: "wix_redirect",
    entityId: id,
  });
  res.json(serialize(row));
});

router.delete("/cms/wix-redirects/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const existing = await db.query.wixRedirectsTable.findFirst({
    where: eq(wixRedirectsTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(wixRedirectsTable).where(eq(wixRedirectsTable.id, id));
  invalidateRedirectCache();
  await audit({
    actorId: req.authedUser!.id,
    action: "wix_redirect.delete",
    entity: "wix_redirect",
    entityId: id,
  });
  res.status(204).end();
});

export default router;
