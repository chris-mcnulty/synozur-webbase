/**
 * Integration tests for POST /api/cms/polaris/episodes/bulk-sync-collateral
 * (#206). The endpoint is a thin loop over every non-deleted Polaris episode
 * that mirrors the same field-set as the per-episode sync handler — the
 * regression risk it covers is silent corruption of `serviceId` /
 * `solutionId` on the linked collateral row, so the assertions focus on
 * those fields specifically.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:polaris-bulk-sync
 *
 * Like sessions.test.ts, this hits the real DATABASE_URL because the
 * route's logic IS the SQL — mocking drizzle would just re-implement it.
 * Each test provisions a throwaway admin user + episode rows scoped by
 * a per-run tag, asserts the post-conditions, then tears them down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  rolesTable,
  userRoles,
  sessionsTable,
  polarisEpisodesTable,
  collateralTable,
  servicesTable,
  solutionsTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/sessions";

interface TestContext {
  userId: string;
  cookie: string;
  baseUrl: string;
  server: http.Server;
  episodeIds: string[];
  serviceId: string | null;
  solutionId: string | null;
  fixtureServiceId: string | null;
  fixtureSolutionId: string | null;
}

async function ensureAdminRoleId(): Promise<string> {
  // The `admin` role is seeded as part of normal app boot (runMigrations
  // populates ROLE_NAMES). We look it up rather than assuming a specific
  // UUID; the row is created at most once across runs.
  const existing = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, "admin"),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(rolesTable)
    .values({ name: "admin" })
    .returning({ id: rolesTable.id });
  return created.id;
}

async function makeAdminUser(tag: string): Promise<string> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `bulk-sync-test-${tag}@example.invalid`,
      displayName: "Bulk Sync Test Admin",
      authProvider: "test",
      externalSubject: `bulk-sync-${tag}`,
    })
    .returning({ id: usersTable.id });
  const roleId = await ensureAdminRoleId();
  await db.insert(userRoles).values({ userId: u.id, roleId });
  return u.id;
}

async function seedFixtureTaxonomy(tag: string): Promise<{
  serviceId: string;
  solutionId: string;
}> {
  // Seed a dedicated service + solution row per run so the propagation
  // assertions are non-trivial: a route that stopped copying serviceId /
  // solutionId could not satisfy `equal(<fixture-uuid>)`. Slugs and
  // sourceIds carry the run tag so cleanup can target only our rows
  // even if the test crashes mid-flight on a previous run.
  const [svc] = await db
    .insert(servicesTable)
    .values({
      slug: `bulk-sync-test-svc-${tag}`,
      title: `Bulk Sync Test Service ${tag}`,
      sourceId: `bulk-sync-test-svc:${tag}`,
      status: "draft",
      active: true,
    })
    .returning({ id: servicesTable.id });
  const [sol] = await db
    .insert(solutionsTable)
    .values({
      slug: `bulk-sync-test-sol-${tag}`,
      title: `Bulk Sync Test Solution ${tag}`,
      solutionGroup: "consulting_services" as const,
      sourceId: `bulk-sync-test-sol:${tag}`,
      parentServiceId: svc.id,
      status: "draft",
      active: true,
    })
    .returning({ id: solutionsTable.id });
  return { serviceId: svc.id, solutionId: sol.id };
}

async function setupContext(tag: string): Promise<TestContext> {
  const userId = await makeAdminUser(tag);
  const { token } = await createSession({
    userId,
    userAgent: `bulk-sync-test/${tag}`,
    ip: "127.0.0.1",
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const cookie = `sid=${encodeURIComponent(token)}`;

  return {
    userId,
    cookie,
    baseUrl,
    server,
    episodeIds: [],
    serviceId: null,
    solutionId: null,
    fixtureServiceId: null,
    fixtureSolutionId: null,
  };
}

async function teardownContext(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    ctx.server.close((err) => (err ? reject(err) : resolve())),
  );
  if (ctx.episodeIds.length > 0) {
    // Hard-delete the collateral rows we created so the run doesn't
    // accumulate `polaris-bulksync-test-*` slugs across iterations.
    await db
      .delete(collateralTable)
      .where(inArray(collateralTable.polarisEpisodeId, ctx.episodeIds));
    await db
      .delete(polarisEpisodesTable)
      .where(inArray(polarisEpisodesTable.id, ctx.episodeIds));
  }
  // Tear down the per-run service + solution fixtures. The solution FK
  // onDelete:set null wouldn't drop the row, so delete it explicitly
  // before the service.
  if (ctx.fixtureSolutionId) {
    await db.delete(solutionsTable).where(eq(solutionsTable.id, ctx.fixtureSolutionId));
  }
  if (ctx.fixtureServiceId) {
    await db.delete(servicesTable).where(eq(servicesTable.id, ctx.fixtureServiceId));
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, ctx.userId));
  await db.delete(usersTable).where(eq(usersTable.id, ctx.userId));
}

async function insertEpisode(
  tag: string,
  index: number,
  fields: {
    serviceId: string | null;
    solutionId: string | null;
  },
): Promise<string> {
  const slug = `bulk-sync-test-${tag}-${index}`;
  const [row] = await db
    .insert(polarisEpisodesTable)
    .values({
      slug,
      title: `Bulk Sync Test Episode ${tag}-${index}`,
      episodeNumber: 900000 + Math.floor(Math.random() * 90000) + index,
      summary: `Episode ${index} fixture for bulk-sync regression test.`,
      audioUrl: "https://example.invalid/audio.mp3",
      artworkUrl: "https://example.invalid/art.png",
      status: "published",
      active: true,
      featured: false,
      publishedAt: new Date(),
      serviceId: fields.serviceId,
      solutionId: fields.solutionId,
    })
    .returning({ id: polarisEpisodesTable.id });
  return row.id;
}

async function insertPreExistingCollateral(
  episodeId: string,
  slug: string,
): Promise<string> {
  // Seed a stale collateral row whose serviceId/solutionId deliberately
  // differ from the episode's so we can assert the bulk-sync overwrites
  // them. We pick NULLs as the stale state to make the assertion
  // robust regardless of whether the local DB has any seeded services.
  const [row] = await db
    .insert(collateralTable)
    .values({
      slug,
      type: "podcast",
      title: "stale title",
      description: "stale description",
      polarisEpisodeId: episodeId,
      serviceId: null,
      solutionId: null,
      sourceId: `polaris_episode:${episodeId}`,
      tags: [],
    })
    .returning({ id: collateralTable.id });
  return row.id;
}

test("POST /cms/polaris/episodes/bulk-sync-collateral updates linked rows and creates missing ones", async () => {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ctx = await setupContext(tag);
  try {
    const taxo = await seedFixtureTaxonomy(tag);
    ctx.fixtureServiceId = taxo.serviceId;
    ctx.fixtureSolutionId = taxo.solutionId;
    ctx.serviceId = taxo.serviceId;
    ctx.solutionId = taxo.solutionId;

    // Episode A: already has a (stale) collateral mirror — must be
    // updated in place, with serviceId/solutionId pulled from the
    // episode.
    const episodeA = await insertEpisode(tag, 1, taxo);
    ctx.episodeIds.push(episodeA);
    const staleCollateralId = await insertPreExistingCollateral(
      episodeA,
      `polaris-bulk-sync-test-${tag}-stale`,
    );

    // Episode B: no collateral mirror — bulk-sync must create one.
    const episodeB = await insertEpisode(tag, 2, taxo);
    ctx.episodeIds.push(episodeB);

    const res = await fetch(
      `${ctx.baseUrl}/api/cms/polaris/episodes/bulk-sync-collateral`,
      {
        method: "POST",
        headers: { cookie: ctx.cookie, "content-type": "application/json" },
      },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      total: number;
      created: number;
      updated: number;
    };

    // The DB may contain other non-deleted episodes from prior runs or
    // the seed; we assert lower bounds rather than exact counts so the
    // test is resilient to unrelated data.
    assert.ok(body.total >= 2, `total ${body.total} should include at least our 2 episodes`);
    assert.ok(body.updated >= 1, `updated ${body.updated} should include episode A`);
    assert.ok(body.created >= 1, `created ${body.created} should include episode B`);

    // Updated case — same row id, serviceId/solutionId now match the episode.
    const updatedRow = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.id, staleCollateralId),
    });
    assert.ok(updatedRow, "stale collateral row should still exist (updated in place)");
    assert.equal(updatedRow!.polarisEpisodeId, episodeA);
    assert.equal(updatedRow!.serviceId, taxo.serviceId);
    assert.equal(updatedRow!.solutionId, taxo.solutionId);
    assert.equal(updatedRow!.sourceId, `polaris_episode:${episodeA}`);

    // Created case — a new collateral row exists for episode B with the
    // expected serviceId/solutionId mirrored from the episode.
    const createdRow = await db.query.collateralTable.findFirst({
      where: and(
        eq(collateralTable.polarisEpisodeId, episodeB),
        eq(collateralTable.type, "podcast"),
      ),
    });
    assert.ok(createdRow, "bulk-sync should have created a collateral row for episode B");
    assert.equal(createdRow!.serviceId, taxo.serviceId);
    assert.equal(createdRow!.solutionId, taxo.solutionId);
    assert.equal(createdRow!.sourceId, `polaris_episode:${episodeB}`);
    assert.equal(createdRow!.title, `Bulk Sync Test Episode ${tag}-2`);
  } finally {
    await teardownContext(ctx);
  }
});

test("POST /cms/polaris/episodes/bulk-sync-collateral rejects non-admin callers", async () => {
  // Sanity check: the adminGuard chain is wired up. Without a session
  // cookie the request should be rejected with 401 before any DB writes
  // happen.
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-anon`;
  const ctx = await setupContext(tag);
  try {
    const res = await fetch(
      `${ctx.baseUrl}/api/cms/polaris/episodes/bulk-sync-collateral`,
      { method: "POST" },
    );
    assert.equal(res.status, 401);
  } finally {
    await teardownContext(ctx);
  }
});

test.after(async () => {
  await pool.end();
});
