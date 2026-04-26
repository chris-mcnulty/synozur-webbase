/**
 * Unit tests for resolveSession() idle-timeout behaviour.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:sessions
 *
 * These tests insert a real (throwaway) user + session row into the configured
 * DATABASE_URL, then directly manipulate `lastSeenAt` to drive the resolver
 * across the IDLE_TIMEOUT_MS boundary. We use the live DB rather than a mock
 * because the resolver also performs the side-effecting DELETE that we need to
 * assert on; mocking drizzle would just re-implement the SQL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool, sessionsTable, usersTable } from "@workspace/db";
import { createSession, resolveSession } from "./sessions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOUR = 60 * 60 * 1000;

async function makeTestUser(): Promise<string> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `idle-test-${tag}@example.invalid`,
      displayName: "Idle Timeout Test User",
      authProvider: "test",
      externalSubject: `idle-test-${tag}`,
    })
    .returning({ id: usersTable.id });
  return u.id;
}

async function deleteUser(userId: string): Promise<void> {
  // Cascades to sessions via FK on sessions.user_id.
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

test("resolveSession: a session with lastSeenAt beyond IDLE_TIMEOUT_MS is rejected and its row is deleted", async () => {
  const userId = await makeTestUser();
  try {
    const { token, rowId } = await createSession({
      userId,
      userAgent: null,
      ip: null,
    });

    // Default IDLE_TIMEOUT_MS is 4h; push lastSeenAt to 5h ago. Keep
    // expiresAt in the future so we isolate the idle check from the rolling
    // expiry check, and leave createdAt fresh so the absolute-cap check
    // doesn't fire either.
    const stale = new Date(Date.now() - 5 * HOUR);
    const future = new Date(Date.now() + HOUR);
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: stale, expiresAt: future })
      .where(eq(sessionsTable.id, rowId));

    const resolved = await resolveSession(token);
    assert.equal(resolved, null, "stale session should resolve to null");

    const [row] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, rowId))
      .limit(1);
    assert.equal(row, undefined, "stale session row should be deleted");
  } finally {
    await deleteUser(userId);
  }
});

test("resolveSession: a session with recent lastSeenAt is still valid", async () => {
  const userId = await makeTestUser();
  try {
    const { token, rowId } = await createSession({
      userId,
      userAgent: null,
      ip: null,
    });

    const resolved = await resolveSession(token);
    assert.ok(resolved, "fresh session should resolve");
    assert.equal(resolved!.userId, userId, "resolves to the owning user");

    const [row] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, rowId))
      .limit(1);
    assert.ok(row, "fresh session row should still exist after resolve");
  } finally {
    await deleteUser(userId);
  }
});

test("resolveSession: IDLE_TIMEOUT_MS env override is respected", async () => {
  // The override constant is captured at module load time, so we can't change
  // it from inside this process. Instead, spawn a fresh node process with
  // IDLE_TIMEOUT_MS=2h and ask it to resolve a session whose lastSeenAt is
  // 3h old. With the default (4h) such a session would be valid; under the
  // override it must be rejected and the row deleted.
  const userId = await makeTestUser();
  try {
    const { token, rowId } = await createSession({
      userId,
      userAgent: null,
      ip: null,
    });

    const stale = new Date(Date.now() - 3 * HOUR);
    const future = new Date(Date.now() + HOUR);
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: stale, expiresAt: future })
      .where(eq(sessionsTable.id, rowId));

    // Sanity: with the default 4h window this same session is still valid.
    const baselineResolved = await resolveSession(token);
    assert.ok(
      baselineResolved,
      "3h-old session should still be valid under the default 4h window",
    );

    // Now spawn the harness with IDLE_TIMEOUT_MS=2h. We have to re-stale the
    // row because the baseline resolveSession() above may have just rolled
    // lastSeenAt forward as part of its renewal path.
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: stale, expiresAt: future })
      .where(eq(sessionsTable.id, rowId));

    const harness = path.join(__dirname, "sessions.test.idleHarness.ts");
    const overrideMs = 2 * HOUR;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", harness, token],
      {
        env: { ...process.env, IDLE_TIMEOUT_MS: String(overrideMs) },
        encoding: "utf8",
      },
    );
    assert.equal(
      result.status,
      0,
      `idle harness exited non-zero: ${result.stderr}`,
    );
    const lastLine = result.stdout.trim().split("\n").pop();
    assert.equal(
      lastLine,
      "null",
      `harness should report null under override (stdout=${result.stdout})`,
    );

    const [row] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, rowId))
      .limit(1);
    assert.equal(
      row,
      undefined,
      "row should be deleted by the override-driven idle expiry",
    );
  } finally {
    await deleteUser(userId);
  }
});

test.after(async () => {
  await pool.end();
});
