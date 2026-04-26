import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  collateralTable,
  collateralResourcesTable,
  mediaTable,
  type CollateralResource,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { audit } from "../lib/audit";

const router: IRouter = Router();

const adminGuard = [requireAuth, requireRole("admin", "editor")];
const readGuard = [requireAuth];

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

type ResourceJoinRow = {
  resource: CollateralResource;
  mediaPublicUrl: string | null;
};

function serialize(row: ResourceJoinRow) {
  const r = row.resource;
  // Resolved URL the client can render directly. Prefer the media's
  // publicUrl when the row is media-backed; fall back to the externalUrl.
  // A resource always has at least one of the two (DB CHECK enforces it).
  const url = row.mediaPublicUrl ?? r.externalUrl ?? "";
  return {
    id: r.id,
    collateralId: r.collateralId,
    mediaId: r.mediaId,
    externalUrl: r.externalUrl,
    label: r.label,
    mimeType: r.mimeType,
    sortOrder: r.sortOrder,
    url,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function loadResourcesForCollateral(
  collateralId: string,
): Promise<ResourceJoinRow[]> {
  const rows = await db
    .select({
      resource: collateralResourcesTable,
      mediaPublicUrl: mediaTable.publicUrl,
    })
    .from(collateralResourcesTable)
    .leftJoin(mediaTable, eq(collateralResourcesTable.mediaId, mediaTable.id))
    .where(eq(collateralResourcesTable.collateralId, collateralId))
    .orderBy(asc(collateralResourcesTable.sortOrder), asc(collateralResourcesTable.createdAt));
  return rows.map((r) => ({
    resource: r.resource,
    mediaPublicUrl: r.mediaPublicUrl ?? null,
  }));
}

export async function loadSerializedResourcesForCollateral(collateralId: string) {
  const rows = await loadResourcesForCollateral(collateralId);
  return rows.map(serialize);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateBody = z
  .object({
    mediaId: z.string().uuid().nullish(),
    externalUrl: z.string().trim().min(1).nullish(),
    label: z.string().trim().min(1),
    mimeType: z.string().nullish(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => !!v.mediaId || !!v.externalUrl, {
    message: "Provide either mediaId or externalUrl",
  });

const PatchBody = z
  .object({
    mediaId: z.string().uuid().nullish(),
    externalUrl: z.string().trim().min(1).nullish(),
    label: z.string().trim().min(1).optional(),
    mimeType: z.string().nullish(),
    sortOrder: z.number().int().optional(),
  })
  .refine(
    (v) =>
      v.mediaId === undefined &&
      v.externalUrl === undefined &&
      v.label === undefined &&
      v.mimeType === undefined &&
      v.sortOrder === undefined
        ? false
        : true,
    { message: "Provide at least one field to update" },
  );

const ReorderBody = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "ids must contain unique values",
    }),
});

// `downloadUrl` is mirrored to the first-by-sortOrder media-or-external URL.
// Editors still see a read-only "Download URL" field on the collateral form
// (until the column is dropped in a follow-up); keeping the mirror in sync
// here means the legacy public detail fallback keeps working without a
// secondary write path.
async function refreshDownloadUrlMirror(collateralId: string) {
  const first = await db
    .select({
      externalUrl: collateralResourcesTable.externalUrl,
      mediaPublicUrl: mediaTable.publicUrl,
    })
    .from(collateralResourcesTable)
    .leftJoin(mediaTable, eq(collateralResourcesTable.mediaId, mediaTable.id))
    .where(eq(collateralResourcesTable.collateralId, collateralId))
    .orderBy(asc(collateralResourcesTable.sortOrder), asc(collateralResourcesTable.createdAt))
    .limit(1);
  const next = first[0]?.mediaPublicUrl ?? first[0]?.externalUrl ?? null;
  await db
    .update(collateralTable)
    .set({ downloadUrl: next, updatedAt: new Date() })
    .where(eq(collateralTable.id, collateralId));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/cms/collateral/:id/resources", ...readGuard, async (req, res) => {
  const id = String(req.params.id);
  const parent = await db.query.collateralTable.findFirst({
    where: and(eq(collateralTable.id, id), isNull(collateralTable.deletedAt)),
  });
  if (!parent) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await loadResourcesForCollateral(id);
  res.json({ items: rows.map(serialize) });
});

router.post("/cms/collateral/:id/resources", ...adminGuard, async (req, res) => {
  const id = String(req.params.id);
  const parent = await db.query.collateralTable.findFirst({
    where: and(eq(collateralTable.id, id), isNull(collateralTable.deletedAt)),
  });
  if (!parent) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;

  // Default sortOrder to "after the current last row" when the client omits it.
  let sortOrder = d.sortOrder;
  if (sortOrder === undefined) {
    const last = await db
      .select({ max: collateralResourcesTable.sortOrder })
      .from(collateralResourcesTable)
      .where(eq(collateralResourcesTable.collateralId, id))
      .orderBy(asc(collateralResourcesTable.sortOrder));
    const highest = last.reduce((max, r) => Math.max(max, r.max), 0);
    sortOrder = highest + 10;
  }

  const [row] = await db
    .insert(collateralResourcesTable)
    .values({
      collateralId: id,
      mediaId: d.mediaId ?? null,
      externalUrl: d.externalUrl ?? null,
      label: d.label,
      mimeType: d.mimeType ?? null,
      sortOrder,
    })
    .returning();

  // Hydrate the media join for the response.
  const media = row.mediaId
    ? await db.query.mediaTable.findFirst({ where: eq(mediaTable.id, row.mediaId) })
    : null;

  await refreshDownloadUrlMirror(id);
  await audit({
    actorId: req.authedUser!.id,
    action: "collateral_resource.create",
    entity: "collateral_resource",
    entityId: row.id,
  });

  res.status(201).json(
    serialize({
      resource: row,
      mediaPublicUrl: media?.publicUrl ?? null,
    }),
  );
});

router.patch(
  "/cms/collateral/:id/resources/:resourceId",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const resourceId = String(req.params.resourceId);
    const existing = await db.query.collateralResourcesTable.findFirst({
      where: and(
        eq(collateralResourcesTable.id, resourceId),
        eq(collateralResourcesTable.collateralId, id),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (d.mediaId !== undefined) updates.mediaId = d.mediaId;
    if (d.externalUrl !== undefined) updates.externalUrl = d.externalUrl;
    if (d.label !== undefined) updates.label = d.label;
    if (d.mimeType !== undefined) updates.mimeType = d.mimeType;
    if (d.sortOrder !== undefined) updates.sortOrder = d.sortOrder;

    // Enforce target invariant on the merged shape — the DB CHECK would
    // catch this anyway, but a clearer 400 is friendlier for the admin UI.
    const nextMediaId = "mediaId" in updates ? (updates.mediaId as string | null) : existing.mediaId;
    const nextExternalUrl =
      "externalUrl" in updates
        ? (updates.externalUrl as string | null)
        : existing.externalUrl;
    if (!nextMediaId && !nextExternalUrl) {
      res
        .status(400)
        .json({ error: "Either mediaId or externalUrl must remain set" });
      return;
    }

    const [updated] = await db
      .update(collateralResourcesTable)
      .set(updates)
      .where(eq(collateralResourcesTable.id, resourceId))
      .returning();

    const media = updated.mediaId
      ? await db.query.mediaTable.findFirst({ where: eq(mediaTable.id, updated.mediaId) })
      : null;

    await refreshDownloadUrlMirror(id);
    await audit({
      actorId: req.authedUser!.id,
      action: "collateral_resource.update",
      entity: "collateral_resource",
      entityId: resourceId,
    });

    res.json(
      serialize({ resource: updated, mediaPublicUrl: media?.publicUrl ?? null }),
    );
  },
);

router.delete(
  "/cms/collateral/:id/resources/:resourceId",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const resourceId = String(req.params.resourceId);
    const existing = await db.query.collateralResourcesTable.findFirst({
      where: and(
        eq(collateralResourcesTable.id, resourceId),
        eq(collateralResourcesTable.collateralId, id),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(collateralResourcesTable)
      .where(eq(collateralResourcesTable.id, resourceId));
    await refreshDownloadUrlMirror(id);
    await audit({
      actorId: req.authedUser!.id,
      action: "collateral_resource.delete",
      entity: "collateral_resource",
      entityId: resourceId,
    });
    res.status(204).end();
  },
);

router.post(
  "/cms/collateral/:id/resources/reorder",
  ...adminGuard,
  async (req, res) => {
    const id = String(req.params.id);
    const parent = await db.query.collateralTable.findFirst({
      where: and(eq(collateralTable.id, id), isNull(collateralTable.deletedAt)),
    });
    if (!parent) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const parsed = ReorderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { ids } = parsed.data;

    const existing = await db
      .select({ id: collateralResourcesTable.id })
      .from(collateralResourcesTable)
      .where(
        and(
          eq(collateralResourcesTable.collateralId, id),
          inArray(collateralResourcesTable.id, ids),
        ),
      );
    if (existing.length !== ids.length) {
      const known = new Set(existing.map((r) => r.id));
      res.status(400).json({
        error: "Unknown or out-of-collateral resource ids",
        missing: ids.filter((x) => !known.has(x)),
      });
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(collateralResourcesTable)
          .set({ sortOrder: (i + 1) * 10, updatedAt: now })
          .where(eq(collateralResourcesTable.id, ids[i]!));
      }
    });

    await refreshDownloadUrlMirror(id);
    await audit({
      actorId: req.authedUser!.id,
      action: "collateral_resource.reorder",
      entity: "collateral_resource",
      entityId: id,
    });
    res.status(204).end();
  },
);

export default router;
