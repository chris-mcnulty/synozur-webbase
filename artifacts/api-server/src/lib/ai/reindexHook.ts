import type { Logger } from "pino";
import { eq } from "drizzle-orm";
import {
  db,
  faqItemsTable,
  type EditorialSourceKind,
} from "@workspace/db";
import { reindexEditorialSource } from "./editorialIndex";

// Best-effort wrapper around `reindexEditorialSource` for use inside
// publish/update/delete lifecycle handlers. The Ask Synozur corpus is a
// derived view of the editorial artifacts — a transient indexer failure
// must never block the underlying mutation. The next save (or a manual
// "Rebuild corpus" run) will re-converge the chunk store.
export async function reindexEditorialSourceSafe(
  kind: EditorialSourceKind,
  id: string,
  log: Pick<Logger, "error">,
): Promise<void> {
  try {
    await reindexEditorialSource(kind, id);
  } catch (err) {
    log.error(
      { err, kind, id },
      "Failed to refresh Ask Synozur corpus for editorial source",
    );
  }
}

// FAQ items inherit their visibility from the parent category (the loader
// in editorialIndex.ts joins category status/active/publish window onto
// each item). When a category is updated, deleted, or has its publish
// window flipped, every FAQ item underneath it can change indexability,
// so we fan out a per-item reindex. Best-effort, mirrors the single-source
// helper. The category itself is not an editorial source — only its items.
export async function reindexEditorialFaqCategorySafe(
  categoryId: string,
  log: Pick<Logger, "error">,
): Promise<void> {
  let itemIds: string[] = [];
  try {
    const rows = await db
      .select({ id: faqItemsTable.id })
      .from(faqItemsTable)
      .where(eq(faqItemsTable.categoryId, categoryId));
    itemIds = rows.map((r) => r.id);
  } catch (err) {
    log.error(
      { err, categoryId },
      "Failed to enumerate FAQ items for corpus refresh",
    );
    return;
  }
  for (const itemId of itemIds) {
    await reindexEditorialSourceSafe("faq", itemId, log);
  }
}
