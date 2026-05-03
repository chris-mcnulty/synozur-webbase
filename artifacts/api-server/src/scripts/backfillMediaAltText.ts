/**
 * #142 Phase A — Backfill: ensure every `media` row has a non-empty
 * `alt_text` so the column can be tightened to NOT NULL in the schema
 * push that follows. Run once before
 *
 *   pnpm --filter @workspace/db run push
 *
 * Idempotent: rows whose alt_text is already a non-empty trimmed string
 * are skipped.
 *
 * Placeholder strategy:
 *   - When `original_name` is set and non-empty, use
 *     `Image: <original_name without extension>` so editors know it's
 *     a deterministic placeholder rather than authored copy.
 *   - When `original_name` is null/empty, fall back to the storageKey's
 *     trailing filename, or "Untitled image" as a last resort.
 *
 * The placeholder shape is intentionally distinguishable: the
 * authoring-time UI flags rows whose alt_text starts with "Image: " as
 * "needs review" so editors are prompted to write real copy on the
 * next pass.
 */
import { sql, isNull, or, eq } from "drizzle-orm";
import { db, pool, mediaTable } from "@workspace/db";

function placeholderFor(row: {
  originalName: string | null;
  storageKey: string;
}): string {
  const name = row.originalName?.trim();
  if (name) {
    // Drop the file extension when computing the placeholder — alt text
    // describes the image content, not the file format. Editors can rewrite
    // the whole string from the asset library.
    const withoutExt = name.replace(/\.[^./\\]+$/, "");
    if (withoutExt) return `Image: ${withoutExt}`;
  }
  const tail = row.storageKey.split("/").pop()?.replace(/\.[^./\\]+$/, "") ?? "";
  if (tail) return `Image: ${tail}`;
  return "Untitled image";
}

async function main() {
  const candidates = await db
    .select({
      id: mediaTable.id,
      originalName: mediaTable.originalName,
      storageKey: mediaTable.storageKey,
      altText: mediaTable.altText,
    })
    .from(mediaTable)
    .where(
      or(
        isNull(mediaTable.altText),
        sql`length(trim(${mediaTable.altText})) = 0`,
      ),
    );

  let updated = 0;
  for (const row of candidates) {
    const next = placeholderFor(row);
    await db
      .update(mediaTable)
      .set({ altText: next })
      .where(eq(mediaTable.id, row.id));
    updated += 1;
  }

   
  console.log(
    `Backfill complete. updated=${updated}; skipped=${0} (already non-empty rows are not selected); candidates=${candidates.length}.`,
  );

  await pool.end();
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
