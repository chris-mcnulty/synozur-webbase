/**
 * Bulk-syncs all existing (non-deleted) workshops into the collateral table.
 * Run once after the 'workshop' collateral_type enum value has been added
 * by migration step 26.
 *
 * Usage (from workspace root):
 *   cd lib/db && pnpm exec tsx src/seeds/backfillWorkshopsCollateral.ts
 */
import { isNull, eq } from "drizzle-orm";
import { db, pool } from "../index";
import { workshopsTable, collateralTable } from "../schema";

const WORKSHOP_SOURCE_PREFIX = "workshop:";

function workshopSourceId(id: string) {
  return `${WORKSHOP_SOURCE_PREFIX}${id}`;
}

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = toSlug(base);
  let i = 1;
  while (true) {
    const found = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.slug, slug),
    });
    if (!found) return slug;
    i++;
    slug = `${toSlug(base)}-${i}`;
  }
}

async function main() {
  const workshops = await db
    .select()
    .from(workshopsTable)
    .where(isNull(workshopsTable.deletedAt));

  console.log(`Found ${workshops.length} workshops to sync into collateral`);
  let synced = 0;
  let failed = 0;

  for (const w of workshops) {
    try {
      const sourceId = workshopSourceId(w.id);
      const isActive = w.active && !w.deletedAt;
      const now = new Date();

      const existing = await db.query.collateralTable.findFirst({
        where: eq(collateralTable.sourceId, sourceId),
      });

      const syncedFields = {
        type: "workshop" as const,
        title: w.title,
        subtitle: w.category || null,
        description: w.shortDescription ?? "",
        heroImage: w.heroImage ?? "",
        tags: [] as string[],
        url: `/workshops/${w.slug}`,
        external: false,
        publishedAt: null,
        featured: false,
        featuredRank: null,
        serviceId: w.serviceId,
        solutionId: w.solutionId,
        active: isActive,
        updatedAt: now,
      };

      if (existing) {
        await db
          .update(collateralTable)
          .set({
            ...syncedFields,
            deletedAt: isActive ? null : existing.deletedAt,
          })
          .where(eq(collateralTable.id, existing.id));
      } else {
        const slug = await ensureUniqueSlug(w.slug);
        await db.insert(collateralTable).values({
          ...syncedFields,
          slug,
          sourceId,
        });
      }

      console.log(`  ✓ ${w.title} (active=${isActive})`);
      synced++;
    } catch (e) {
      console.error(`  ✗ ${w.title}:`, e instanceof Error ? e.message : e);
      failed++;
    }
  }

  console.log(`\nDone: ${synced} synced, ${failed} failed`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
