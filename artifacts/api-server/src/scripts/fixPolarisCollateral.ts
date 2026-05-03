/**
 * #183 — Backfill: re-sync serviceId / solutionId on every collateral record
 * that is linked to a Polaris episode. Episodes that have no collateral mirror
 * yet are also created so nothing is left behind.
 *
 * Run once (idempotent — safe to re-run):
 *
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/fixPolarisCollateral.ts
 *
 * What it does for each non-deleted episode:
 *   - If a live collateral row already exists  → update serviceId + solutionId
 *     (and the other sync fields so the record is fully up-to-date).
 *   - If no collateral row exists yet           → create one (same slug logic
 *     as the /sync-collateral endpoint so slugs stay stable on re-runs).
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  pool,
  polarisEpisodesTable,
  collateralTable,
} from "@workspace/db";
import { canonicalUrlForCollateral } from "@workspace/api-zod";
import { toSlug } from "../lib/slug.js";

async function ensureUniqueCollateralSlug(base: string): Promise<string> {
  let candidate = base;
  let i = 1;
  for (;;) {
    const conflict = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.slug, candidate),
    });
    if (!conflict) return candidate;
    i++;
    candidate = `${base}-${i}`;
  }
}

async function main() {
  const episodes = await db.query.polarisEpisodesTable.findMany({
    where: isNull(polarisEpisodesTable.deletedAt),
  });

  console.log(`Found ${episodes.length} active Polaris episode(s) to process.`);

  let created = 0;
  let updated = 0;
  const skipped = 0;

  for (const episode of episodes) {
    const syncFields = {
      title: episode.title,
      description: episode.summary || "",
      heroImage: episode.artworkUrl || "",
      url: canonicalUrlForCollateral("podcast", episode.slug),
      external: false,
      publishedAt: episode.publishedAt,
      active: episode.active,
      featured: episode.featured,
      featuredRank: episode.featuredRank ?? null,
      sourceId: `polaris_episode:${episode.id}`,
      serviceId: episode.serviceId ?? null,
      solutionId: episode.solutionId ?? null,
      updatedAt: new Date(),
    };

    const existing = await db.query.collateralTable.findFirst({
      where: and(
        eq(collateralTable.polarisEpisodeId, episode.id),
        isNull(collateralTable.deletedAt),
      ),
    });

    if (existing) {
      const prev = { serviceId: existing.serviceId, solutionId: existing.solutionId };
      await db
        .update(collateralTable)
        .set(syncFields)
        .where(eq(collateralTable.id, existing.id));
      console.log(
        `  updated  ${episode.slug} — serviceId: ${prev.serviceId ?? "null"} → ${syncFields.serviceId ?? "null"}, solutionId: ${prev.solutionId ?? "null"} → ${syncFields.solutionId ?? "null"}`,
      );
      updated++;
    } else {
      const base = toSlug(`polaris-${episode.slug}`);
      const slug = await ensureUniqueCollateralSlug(base);
      await db.insert(collateralTable).values({
        slug,
        type: "podcast",
        polarisEpisodeId: episode.id,
        ...syncFields,
        tags: [],
        subtitle: episode.guestName ?? null,
        pillar: null,
        videoUrl: null,
        downloadUrl: null,
      });
      console.log(`  created  ${episode.slug} → collateral slug "${slug}"`);
      created++;
    }
  }

  console.log(
    `\nDone. created=${created}, updated=${updated}, skipped=${skipped}, total=${episodes.length}.`,
  );

  await pool.end();
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
