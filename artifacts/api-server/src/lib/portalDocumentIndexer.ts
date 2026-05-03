// #227 — Portal document indexer.
//
// Walks the SPE folder tied to an engagement and upserts a row in
// `portal_documents` for every file it finds. The indexer is the only
// writer of the SPE-derived fields (filename, contentType, sizeBytes,
// lastModifiedAt, indexedAt) and never touches `publishedAt` —
// publishing is an explicit admin action so a freshly-indexed file
// does NOT immediately leak to the client.
//
// Files that were previously indexed but no longer exist in SPE are
// soft-deleted (deletedAt set) so the published view stops showing
// them but the audit trail is preserved.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, engagementsTable, portalDocumentsTable } from "@workspace/db";
import { speFileStorage } from "./storage/spe/fileStorage";
import { logger } from "./logger";

export interface IndexResult {
  engagementId: string;
  spePath: string;
  added: number;
  updated: number;
  removed: number;
  totalIndexed: number;
}

// Walk a single engagement's SPE folder and reconcile portal_documents.
// Returns null if the engagement has no spePath set or doesn't exist.
export async function indexEngagementDocuments(
  engagementId: string,
): Promise<IndexResult | null> {
  const engagement = await db.query.engagementsTable.findFirst({
    where: eq(engagementsTable.id, engagementId),
  });
  if (!engagement || engagement.deletedAt) return null;
  if (!engagement.spePath) return null;

  const containerId = await speFileStorage.resolveContainerId();
  const graph = speFileStorage.graphClient();

  // Recursively list every file under the engagement folder. Folders
  // are traversed but not indexed — only leaves end up as documents.
  const seen: Array<{
    itemId: string;
    name: string;
    size: number;
    contentType: string;
    lastModifiedAt: Date | null;
    webUrl: string | null;
  }> = [];
  async function walk(folder: string): Promise<void> {
    const children = await graph.listChildren(containerId, folder);
    for (const child of children) {
      if (child.kind === "folder") {
        const next = folder.endsWith("/") ? `${folder}${child.name}` : `${folder}/${child.name}`;
        await walk(next);
      } else {
        seen.push({
          itemId: child.id,
          name: child.name,
          size: child.size,
          contentType: child.contentType,
          lastModifiedAt: child.lastModifiedDateTime ? new Date(child.lastModifiedDateTime) : null,
          webUrl: child.webUrl ?? null,
        });
      }
    }
  }
  await walk(engagement.spePath);

  // Existing rows for this engagement, keyed by SPE item id.
  const existingRows = await db
    .select()
    .from(portalDocumentsTable)
    .where(eq(portalDocumentsTable.engagementId, engagementId));
  const existingByItemId = new Map(existingRows.map((r) => [r.spaceItemId, r]));

  let added = 0;
  let updated = 0;
  const now = new Date();
  const seenItemIds = new Set<string>();

  for (const file of seen) {
    seenItemIds.add(file.itemId);
    const prev = existingByItemId.get(file.itemId);
    if (!prev) {
      await db.insert(portalDocumentsTable).values({
        engagementId,
        spePath: engagement.spePath,
        spaceItemId: file.itemId,
        filename: file.name,
        contentType: file.contentType ?? "",
        sizeBytes: file.size ?? 0,
        lastModifiedAt: file.lastModifiedAt,
        webUrl: file.webUrl,
        indexedAt: now,
      });
      added++;
    } else {
      const changed =
        prev.filename !== file.name ||
        prev.contentType !== (file.contentType ?? "") ||
        prev.sizeBytes !== (file.size ?? 0) ||
        (prev.lastModifiedAt?.getTime() ?? null) !== (file.lastModifiedAt?.getTime() ?? null) ||
        prev.deletedAt !== null ||
        prev.spePath !== engagement.spePath ||
        prev.webUrl !== file.webUrl;
      if (changed) {
        await db
          .update(portalDocumentsTable)
          .set({
            filename: file.name,
            contentType: file.contentType ?? "",
            sizeBytes: file.size ?? 0,
            lastModifiedAt: file.lastModifiedAt,
            webUrl: file.webUrl,
            spePath: engagement.spePath,
            indexedAt: now,
            // Resurrect a previously-deleted row if SPE returned it again.
            deletedAt: null,
          })
          .where(eq(portalDocumentsTable.id, prev.id));
        updated++;
      }
    }
  }

  // Soft-delete rows whose SPE item is gone.
  const stale = existingRows.filter(
    (r) => !seenItemIds.has(r.spaceItemId) && r.deletedAt === null,
  );
  let removed = 0;
  if (stale.length > 0) {
    await db
      .update(portalDocumentsTable)
      .set({ deletedAt: now })
      .where(
        and(
          eq(portalDocumentsTable.engagementId, engagementId),
          inArray(
            portalDocumentsTable.id,
            stale.map((r) => r.id),
          ),
        ),
      );
    removed = stale.length;
  }

  return {
    engagementId,
    spePath: engagement.spePath,
    added,
    updated,
    removed,
    totalIndexed: seen.length,
  };
}

// Daily reconcile — walks every active engagement that has an spePath set.
// Errors per engagement are logged and don't abort the run.
export async function reconcileAllEngagementDocuments(): Promise<void> {
  const rows = await db
    .select({ id: engagementsTable.id, slug: engagementsTable.slug })
    .from(engagementsTable)
    .where(
      and(
        isNull(engagementsTable.deletedAt),
        // Skip engagements that haven't had a deliverables folder
        // wired up yet — `indexEngagementDocuments` would early-return
        // anyway, but filtering here avoids the wasted Graph round trip.
        isNotNull(engagementsTable.spePath),
      ),
    );
  for (const row of rows) {
    try {
      const result = await indexEngagementDocuments(row.id);
      if (result) {
        logger.info(
          { slug: row.slug, ...result },
          "portal-document daily reconcile",
        );
      }
    } catch (err) {
      logger.error(
        { err, engagementId: row.id, slug: row.slug },
        "portal-document daily reconcile failed for engagement",
      );
    }
  }
}
