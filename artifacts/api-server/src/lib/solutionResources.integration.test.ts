import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Explicit opt-in: exercises the development DB with isolated, disposable
// fixtures. Never run this against a production connection.
test("ebook sync, existing-assignment repair and solution response work together", {
  skip: process.env.RUN_DB_TESTS !== "1",
}, async () => {
  const {
    db, pool, servicesTable, solutionsTable, whitePapersTable,
    collateralTable, collateralSolutionsTable,
  } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { upsertCollateralFromWhitePaper } = await import("./syncCollateral");
  const { seedWhitePaperAssignmentsIfMissing } = await import("./whitePaperAssignmentsSeed");
  const { getSolutionWithCapabilities } = await import("./servicesSerializer");
  const serviceId = randomUUID();
  const solutionId = randomUUID();
  const otherSolutionId = randomUUID();
  const sourceId = randomUUID();
  const mirrorId = randomUUID();
  const pinnedId = randomUUID();
  const key = `assignment-test-${randomUUID()}`;
  try {
    await db.insert(servicesTable).values({ id: serviceId, slug: key, title: "Assignment test service" });
    await db.insert(solutionsTable).values([
      { id: solutionId, slug: key, title: "Assignment test solution", solutionGroup: "ai_strategy", status: "published", parentServiceId: serviceId },
      { id: otherSolutionId, slug: `${key}-other`, title: "Other assignment test solution", solutionGroup: "ai_strategy", status: "published", parentServiceId: serviceId },
    ]);
    const [source] = await db.insert(whitePapersTable).values({
      id: sourceId, slug: key, title: "Assigned test ebook", docType: "ebook",
      status: "published", publishedAt: new Date("2026-01-01T00:00:00Z"),
      serviceId, solutionId,
    }).returning();
    // Reproduce the old sync: source has its solution, mirror does not.
    await db.insert(collateralTable).values([
      { id: mirrorId, slug: key, title: source.title, type: "ebook", sourceId: `white_paper:${sourceId}` },
      { id: pinnedId, slug: `${key}-pinned`, title: "Curated test paper", type: "white_paper" },
    ]);
    await db.insert(collateralSolutionsTable).values({
      collateralId: pinnedId, solutionId, displayOrder: 3, active: true,
    });

    await seedWhitePaperAssignmentsIfMissing();
    let mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.solutionId, solutionId);
    assert.equal(mirror?.serviceId, serviceId);
    const repairedAt = mirror?.updatedAt.toISOString();
    await seedWhitePaperAssignmentsIfMissing();
    mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.updatedAt.toISOString(), repairedAt, "repair is idempotent");

    await upsertCollateralFromWhitePaper(source);
    mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.type, "ebook");
    assert.equal(mirror?.solutionId, solutionId);
    assert.equal(mirror?.serviceId, serviceId);
    let result = await getSolutionWithCapabilities(key);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") throw new Error("Fixture solution did not load");
    assert.deepEqual(result.data.linkedCollateral.map((c) => c.collateralId), [pinnedId, mirrorId]);

    // Adding a manual link must not create a second copy.
    await db.insert(collateralSolutionsTable).values({
      collateralId: mirrorId, solutionId, displayOrder: 4, active: true,
    });
    result = await getSolutionWithCapabilities(key);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") throw new Error("Fixture solution did not load");
    assert.equal(result.data.linkedCollateral.filter((c) => c.collateralId === mirrorId).length, 1);
    await db.delete(collateralSolutionsTable).where(eq(collateralSolutionsTable.collateralId, mirrorId));

    // Explicit editor changes propagate; old solutions lose the assignment.
    await upsertCollateralFromWhitePaper({ ...source, solutionId: otherSolutionId, docType: "whitepaper" });
    mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.solutionId, otherSolutionId);
    assert.equal(mirror?.type, "white_paper");
    await seedWhitePaperAssignmentsIfMissing();
    mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.solutionId, otherSolutionId, "repair preserves nonblank assignments");
    result = await getSolutionWithCapabilities(key);
    if (result.kind !== "ok") throw new Error("Fixture solution did not load");
    assert.deepEqual(result.data.linkedCollateral.map((c) => c.collateralId), [pinnedId]);

    await upsertCollateralFromWhitePaper({ ...source, solutionId: null });
    mirror = await db.query.collateralTable.findFirst({ where: eq(collateralTable.id, mirrorId) });
    assert.equal(mirror?.solutionId, null, "clearing the editor assignment clears the mirror");
  } finally {
    await db.delete(collateralTable).where(inArray(collateralTable.id, [mirrorId, pinnedId]));
    await db.delete(whitePapersTable).where(eq(whitePapersTable.id, sourceId));
    await db.delete(solutionsTable).where(inArray(solutionsTable.id, [solutionId, otherSolutionId]));
    await db.delete(servicesTable).where(eq(servicesTable.id, serviceId));
    await pool.end();
  }
});