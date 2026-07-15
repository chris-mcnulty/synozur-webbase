/**
 * Integration tests for #466 — white paper publish-date timezone semantics
 * and white-paper → collateral sync (download URL + slug healing).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:white-papers-publish
 *
 * Like the other tests in this workspace, this hits the real DATABASE_URL
 * because the logic under test IS the SQL. Each test provisions throwaway
 * rows scoped by a per-run tag and tears them down.
 *
 * Covers:
 *   - A white paper whose publishedAt is today at midnight UTC (what the
 *     date-only admin picker stores) is immediately visible on the public
 *     list and detail endpoints; a paper dated tomorrow stays hidden.
 *   - upsertCollateralFromWhitePaper resolves a downloadUrl from a
 *     media-picker upload (documentMediaId), not just legacy assets.
 *   - Re-syncing a white paper heals a mismatched collateral slug and
 *     canonical url.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  whitePapersTable,
  collateralTable,
  mediaTable,
} from "@workspace/db";
import app from "../app";
import {
  upsertCollateralFromWhitePaper,
  whitePaperSourceId,
} from "../lib/syncCollateral";

const tag = crypto.randomUUID().slice(0, 8);

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

let server: http.Server;
let baseUrl: string;
const whitePaperIds: string[] = [];
const mediaIds: string[] = [];

async function insertWhitePaper(overrides: Partial<typeof whitePapersTable.$inferInsert> & { slug: string }) {
  const [row] = await db
    .insert(whitePapersTable)
    .values({
      title: `Test WP ${tag}`,
      docType: "whitepaper",
      status: "published",
      active: true,
      publishedAt: startOfTodayUtc(),
      ...overrides,
    })
    .returning();
  whitePaperIds.push(row.id);
  return row;
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (whitePaperIds.length) {
    await db.delete(collateralTable).where(
      inArray(
        collateralTable.sourceId,
        whitePaperIds.map((id) => whitePaperSourceId(id)),
      ),
    );
    await db.delete(whitePapersTable).where(inArray(whitePapersTable.id, whitePaperIds));
  }
  if (mediaIds.length) {
    await db.delete(mediaTable).where(inArray(mediaTable.id, mediaIds));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("white paper published 'today' (midnight UTC) is publicly visible on list and detail", async () => {
  const slug = `wp-today-${tag}`;
  await insertWhitePaper({ slug });

  const listRes = await fetch(`${baseUrl}/api/white-papers?pageSize=50&q=${tag}`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { items: Array<{ slug: string }> };
  assert.ok(
    list.items.some((i) => i.slug === slug),
    "paper dated today should appear on the public list immediately",
  );

  const detailRes = await fetch(`${baseUrl}/api/white-papers/${slug}`);
  assert.equal(detailRes.status, 200, "detail endpoint should not 404 on publish day");
});

test("white paper dated tomorrow stays hidden", async () => {
  const slug = `wp-tomorrow-${tag}`;
  const tomorrow = new Date(startOfTodayUtc().getTime() + 24 * 60 * 60 * 1000);
  await insertWhitePaper({ slug, publishedAt: tomorrow });

  const listRes = await fetch(`${baseUrl}/api/white-papers?pageSize=50&q=${tag}`);
  const list = (await listRes.json()) as { items: Array<{ slug: string }> };
  assert.ok(!list.items.some((i) => i.slug === slug), "future-dated paper must not be listed");

  const detailRes = await fetch(`${baseUrl}/api/white-papers/${slug}`);
  assert.equal(detailRes.status, 404);
});

test("media-backed document produces a collateral downloadUrl", async () => {
  const [media] = await db
    .insert(mediaTable)
    .values({
      storageKey: `/test-wp-${tag}/doc.pdf`,
      publicUrl: `/api/storage/test-wp-${tag}/doc.pdf`,
      altText: "test doc",
      mime: "application/pdf",
    })
    .returning();
  mediaIds.push(media.id);

  const wp = await insertWhitePaper({
    slug: `wp-media-${tag}`,
    documentMediaId: media.id,
  });
  await upsertCollateralFromWhitePaper(wp);

  const col = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, whitePaperSourceId(wp.id)),
  });
  assert.ok(col, "collateral row should be created");
  assert.equal(col!.downloadUrl, media.publicUrl);
});

test("re-sync heals a mismatched collateral slug and canonical url", async () => {
  const goodSlug = `wp-heal-${tag}`;
  const wp = await insertWhitePaper({ slug: goodSlug });
  await upsertCollateralFromWhitePaper(wp);

  // Simulate the prod drift: collateral row holding a mistyped slug/url.
  await db
    .update(collateralTable)
    .set({ slug: `wp-heel-${tag}`, url: `/white-papers/wp-heel-${tag}` })
    .where(eq(collateralTable.sourceId, whitePaperSourceId(wp.id)));

  await upsertCollateralFromWhitePaper(wp);

  const col = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, whitePaperSourceId(wp.id)),
  });
  assert.equal(col!.slug, goodSlug);
  assert.equal(col!.url, `/white-papers/${goodSlug}`);
});
