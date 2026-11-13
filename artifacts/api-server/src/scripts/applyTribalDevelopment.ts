/**
 * Explicit development-only content update. Never imported by startup or migrations.
 * NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/applyTribalDevelopment.ts --apply-development
 */
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool, bookingsTable, landingPagesTable } from "@workspace/db";
import { BlockSchema } from "../routes/landingPagesSchema";
import { upsertCollateralFromLandingPage } from "../lib/syncCollateral";

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" ||
      !process.argv.includes("--apply-development")) {
    throw new Error("This manual script requires the development workspace and --apply-development.");
  }
  const content = JSON.parse(readFileSync(new URL("../content/tribal-first-nations.dev.json", import.meta.url), "utf8"));
  const bookingContent = JSON.parse(readFileSync(new URL("../content/tribal-context-conversation.json", import.meta.url), "utf8"));
  const page = await db.query.landingPagesTable.findFirst({ where: eq(landingPagesTable.slug, content.slug) });
  const booking = await db.query.bookingsTable.findFirst({
    where: eq(bookingsTable.slug, "tribal-first-nations-workshop"),
  });
  if (!page || !booking) throw new Error("Expected existing development page and booking; no records were changed.");
  if (page.deletedAt || page.status !== "published" || !page.active || !booking.active) {
    throw new Error("Existing visibility changed; review before updating content.");
  }
  const blocks = content.blocks.map((block: unknown) => BlockSchema.parse(block));
  // The live URL and this existing development URL intentionally differ.
  const devBlocks = blocks.map((block: typeof blocks[number]) => block.type === "cta"
    ? { ...block, buttons: block.buttons.map((button: { href: string }) => ({
      ...button, href: button.href === "/start/tribal-nations-first-nations-workshop"
        ? `/start/${booking.slug}` : button.href,
    })) } : block);
  const backup = `/tmp/tribal-development-before-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ page, booking }, null, 2), { mode: 0o600 });
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx.update(landingPagesTable).set({
      title: content.title, subtitle: content.subtitle, description: content.description,
      blocks: devBlocks, seoTitle: content.seoTitle, seoDescription: content.seoDescription,
      ogImageUrl: content.ogImageUrl, tags: content.tags, updatedAt: new Date(),
    }).where(eq(landingPagesTable.id, page.id)).returning();
    await tx.update(bookingsTable).set({
      ...bookingContent, updatedAt: new Date(),
    }).where(eq(bookingsTable.id, booking.id));
    return result!;
  });
  // Use the same Library synchronization as CMS saves; preserve the selected hero.
  await upsertCollateralFromLandingPage(updated);
  console.log(JSON.stringify({ page: page.slug, booking: booking.slug, backup, librarySynced: true }));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
