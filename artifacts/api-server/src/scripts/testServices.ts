/**
 * Integration tests for the services hierarchy.
 *
 * Run with:
 *   node --import <tsx-loader> src/scripts/testServices.ts
 *
 * Assumes the ingest has been executed at least once against the local DB.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
} from "@workspace/db";
import {
  listServicesWithSolutions,
  getServiceWithMethodologies,
  getSolutionWithCapabilities,
} from "../lib/servicesSerializer";
import { runIngest } from "./ingestServices";

async function snapshot() {
  const [svc, sol, m, c] = await Promise.all([
    db
      .select({ id: servicesTable.id, sourceId: servicesTable.sourceId })
      .from(servicesTable),
    db
      .select({ id: solutionsTable.id, sourceId: solutionsTable.sourceId })
      .from(solutionsTable),
    db
      .select({
        id: serviceMethodologiesTable.id,
        sourceId: serviceMethodologiesTable.sourceId,
      })
      .from(serviceMethodologiesTable),
    db
      .select({
        id: solutionCapabilitiesTable.id,
        sourceId: solutionCapabilitiesTable.sourceId,
      })
      .from(solutionCapabilitiesTable),
  ]);
  const idBySource = (rows: { id: string; sourceId: string | null }[]) =>
    new Map(rows.filter((r) => r.sourceId).map((r) => [r.sourceId!, r.id]));
  return {
    counts: { svc: svc.length, sol: sol.length, m: m.length, c: c.length },
    ids: {
      svc: idBySource(svc),
      sol: idBySource(sol),
      m: idBySource(m),
      c: idBySource(c),
    },
  };
}

test("ingest is idempotent: a second run yields stable counts and stable row IDs", async () => {
  // Run ingest twice in the same test process.
  await runIngest();
  const first = await snapshot();
  await runIngest();
  const second = await snapshot();

  assert.deepEqual(second.counts, first.counts, "row counts unchanged on re-run");
  for (const key of ["svc", "sol", "m", "c"] as const) {
    assert.equal(
      second.ids[key].size,
      first.ids[key].size,
      `${key}: same number of source-tracked rows`,
    );
    for (const [sourceId, id] of first.ids[key]) {
      assert.equal(
        second.ids[key].get(sourceId),
        id,
        `${key}: row identity stable for source_id ${sourceId}`,
      );
    }
  }
  // Sanity: the seeded data shape we expect.
  assert.ok(first.counts.svc >= 5, "at least 5 services");
  assert.ok(first.counts.sol >= 12, "at least 12 solutions");
  assert.ok(first.counts.m >= 30, "at least 30 methodologies");
  assert.ok(first.counts.c >= 30, "at least 30 capabilities");
});

test("FK resolution: every solution's parent_service_id resolves to a real service", async () => {
  const orphans = await db
    .select({ id: solutionsTable.id, slug: solutionsTable.slug })
    .from(solutionsTable)
    .leftJoin(servicesTable, eq(solutionsTable.parentServiceId, servicesTable.id))
    .where(sql`${solutionsTable.parentServiceId} IS NOT NULL AND ${servicesTable.id} IS NULL`);
  assert.equal(orphans.length, 0, "no orphan solutions");

  // Every methodology must link to an existing service (FK enforced, but assert anyway).
  const methodologyOrphans = await db
    .select({ id: serviceMethodologiesTable.id })
    .from(serviceMethodologiesTable)
    .leftJoin(servicesTable, eq(serviceMethodologiesTable.serviceId, servicesTable.id))
    .where(sql`${servicesTable.id} IS NULL`);
  assert.equal(methodologyOrphans.length, 0, "no orphan methodologies");
});

test("slug uniqueness: services and solutions slugs are globally unique", async () => {
  const dupSvc = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(sql`(SELECT slug FROM services GROUP BY slug HAVING COUNT(*) > 1) AS d`);
  assert.equal(dupSvc[0].c, 0, "service slugs unique");
  const dupSol = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(sql`(SELECT slug FROM solutions GROUP BY slug HAVING COUNT(*) > 1) AS d`);
  assert.equal(dupSol[0].c, 0, "solution slugs unique");
});

test("methodology titles can collide across services (per-parent uniqueness only)", async () => {
  const counts = await db
    .select({ title: serviceMethodologiesTable.title, c: sql<number>`COUNT(*)::int` })
    .from(serviceMethodologiesTable)
    .groupBy(serviceMethodologiesTable.title);
  const collisions = counts.filter((r) => r.c > 1);
  // We expect at least one duplicated title in the source data (e.g. "Maturity Models").
  assert.ok(collisions.length >= 1, "expected duplicate methodology titles across services");
});

test("public list returns services ordered by display_order, with solutions nested", async () => {
  const items = await listServicesWithSolutions();
  assert.ok(items.length >= 1, "at least one active service");
  // Active filter excludes placeholder services.
  for (const s of items) {
    assert.equal(s.active, true, "only active services returned");
  }
  // Display order is non-decreasing (Postgres ASC sorts NULLs LAST).
  const orders = items.map((s) =>
    s.displayOrder == null ? Number.POSITIVE_INFINITY : s.displayOrder,
  );
  for (let i = 1; i < orders.length; i++) {
    assert.ok(orders[i] >= orders[i - 1], "services ordered by display_order");
  }
  // At least one service with nested solutions.
  const withSolutions = items.find((s) => s.solutions.length > 0);
  assert.ok(withSolutions, "at least one service has nested solutions");
  const solOrders = withSolutions!.solutions.map((s) => s.displayOrder ?? 0);
  for (let i = 1; i < solOrders.length; i++) {
    assert.ok(solOrders[i] >= solOrders[i - 1], "solutions ordered by display_order");
  }
});

test("hidden exclusion: public service detail omits hidden methodologies", async () => {
  // Pick a service that has at least one hidden methodology.
  const candidate = await db
    .select({ slug: servicesTable.slug, serviceId: servicesTable.id })
    .from(servicesTable)
    .innerJoin(
      serviceMethodologiesTable,
      eq(serviceMethodologiesTable.serviceId, servicesTable.id),
    )
    .where(
      sql`${serviceMethodologiesTable.hidden} = true AND ${servicesTable.active} = true`,
    )
    .limit(1);
  if (candidate.length === 0) {
    // No hidden methodologies in seed data; skip without failing.
    return;
  }
  const detail = await getServiceWithMethodologies(candidate[0].slug);
  assert.ok(detail, "service detail loaded");
  for (const m of detail!.methodologies) {
    assert.equal(m.hidden, false, "no hidden methodology surfaced publicly");
  }
});

test("hidden exclusion: public solution detail omits hidden capabilities", async () => {
  const candidate = await db
    .select({ slug: solutionsTable.slug })
    .from(solutionsTable)
    .innerJoin(
      solutionCapabilitiesTable,
      eq(solutionCapabilitiesTable.solutionId, solutionsTable.id),
    )
    .where(
      sql`${solutionCapabilitiesTable.hidden} = true AND ${solutionsTable.active} = true`,
    )
    .limit(1);
  if (candidate.length === 0) return;
  const detail = await getSolutionWithCapabilities(candidate[0].slug);
  assert.ok(detail, "solution detail loaded");
  for (const c of detail!.capabilities) {
    assert.equal(c.hidden, false, "no hidden capability surfaced publicly");
  }
});

test("solution detail returns parent service when present", async () => {
  const sol = await db
    .select({ slug: solutionsTable.slug })
    .from(solutionsTable)
    .where(sql`${solutionsTable.parentServiceId} IS NOT NULL`)
    .limit(1);
  assert.ok(sol.length === 1, "found a solution with parent service");
  const detail = await getSolutionWithCapabilities(sol[0].slug);
  assert.ok(detail, "detail loaded");
  assert.ok(detail!.parentService, "parentService present");
  assert.ok(detail!.capabilities.length >= 0, "capabilities array present");
});

test.after(async () => {
  await pool.end();
});
