import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, publishBlocksTable, type PublishBlock } from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { audit } from "../../lib/audit";
import {
  activeBlocksForCollateral,
  listActivePublishBlocks,
  scanPublishBlocks,
} from "../../lib/publishGate";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];

function serialize(row: PublishBlock) {
  return {
    id: row.id,
    artifactKind: row.artifactKind,
    artifactId: row.artifactId,
    sourceRule: row.sourceRule,
    severity: row.severity,
    reason: row.reason,
    evidence: row.evidence ?? null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy ?? null,
    resolutionNote: row.resolutionNote ?? null,
  };
}

const ListQuery = z.object({
  artifactKind: z.string().min(1).optional(),
  artifactId: z.string().min(1).optional(),
  // When true, include rows that have been resolved (recently or
  // ever). Default false — the admin UI mostly cares about active
  // signals.
  includeResolved: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

router.get("/cms/publish-blocks", ...adminGuard, async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { artifactKind, artifactId, includeResolved } = parsed.data;

  const filters = [];
  if (!includeResolved) filters.push(isNull(publishBlocksTable.resolvedAt));
  if (artifactKind) filters.push(eq(publishBlocksTable.artifactKind, artifactKind));
  if (artifactId) filters.push(eq(publishBlocksTable.artifactId, artifactId));

  const rows = await db
    .select()
    .from(publishBlocksTable)
    .where(filters.length === 0 ? undefined : and(...filters))
    .orderBy(desc(publishBlocksTable.createdAt));
  res.json({ items: rows.map(serialize) });
});

// Convenience endpoint for the collateral edit page: pulls together
// blocks that target this collateral row directly *and* blocks that
// target the route the row publishes to (e.g. a CWV regression on
// `/library/foo` for the row whose canonical URL is `/library/foo`).
router.get(
  "/cms/collateral/:id/publish-blocks",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const rows = await activeBlocksForCollateral(id);
    res.json({ items: rows.map(serialize) });
  },
);

router.post("/cms/publish-blocks/scan", ...adminGuard, async (req, res) => {
  const result = await scanPublishBlocks();
  await audit({
    actorId: req.authedUser!.id,
    action: "publish_block.scan",
    entity: "publish_block",
  });
  res.json(result);
});

const ResolveBody = z.object({
  // Mandatory free-text justification when an admin overrides a block
  // that the scanner still considers active. This lands in the audit
  // log so the override is attributable.
  resolutionNote: z.string().trim().min(1, "A resolution note is required").max(1000),
});

router.delete("/cms/publish-blocks/:id", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const parsed = ResolveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const existing = await db.query.publishBlocksTable.findFirst({
    where: eq(publishBlocksTable.id, id),
  });
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (existing.resolvedAt) {
    res.status(400).json({ error: "Block is already resolved" });
    return;
  }
  const [updated] = await db
    .update(publishBlocksTable)
    .set({
      resolvedAt: new Date(),
      resolvedBy: req.authedUser!.id,
      resolutionNote: parsed.data.resolutionNote,
    })
    .where(eq(publishBlocksTable.id, id))
    .returning();
  await audit({
    actorId: req.authedUser!.id,
    action: "publish_block.resolve",
    entity: "publish_block",
    entityId: id,
  });
  res.json(serialize(updated));
});

// Helper export for the publish mutations to call when warn-mode flips
// to hard-mode in a follow-up.
export { listActivePublishBlocks };

export default router;
