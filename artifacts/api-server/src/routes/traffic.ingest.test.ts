/**
 * Integration tests for POST /api/traffic/ingest (#228).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:traffic-ingest
 *
 * Covers:
 *   1. Missing or malformed Authorization → 401.
 *   2. Bearer token whose 8-char prefix matches no row → 401.
 *   3. Bearer token whose prefix matches but bcrypt-compare fails → 401.
 *   4. Inactive property's valid key → 401.
 *   5. Valid key + valid batch → 202 with tagged propertySlug, rows stored
 *      under that slug as `source_system` on traffic_sessions/pageviews.
 *   6. Re-posting the same batch is idempotent: duplicates increment, no
 *      double-counting in traffic_pageviews.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  trafficPropertiesTable,
  trafficSessionsTable,
  trafficPageviewsTable,
} from "@workspace/db";
import app from "../app";

let server: http.Server;
let baseUrl: string;

const TEST_SLUG = `t-ingest-${randomBytes(4).toString("hex")}`;
const TEST_INACTIVE_SLUG = `t-ingest-inact-${randomBytes(4).toString("hex")}`;
let validKey = "";
let inactiveKey = "";

async function provisionProperty(slug: string, isActive: boolean): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `tp_${raw}`;
  const prefix = plaintext.slice(0, 8);
  const hash = await bcrypt.hash(plaintext, 12);
  await db.insert(trafficPropertiesTable).values({
    slug,
    name: `Test ${slug}`,
    apiKeyHash: hash,
    apiKeyPrefix: prefix,
    isDefault: false,
    isActive,
  });
  return plaintext;
}

test.before(async () => {
  validKey = await provisionProperty(TEST_SLUG, true);
  inactiveKey = await provisionProperty(TEST_INACTIVE_SLUG, false);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  // Clean up our test properties + any traffic rows tagged to them.
  for (const slug of [TEST_SLUG, TEST_INACTIVE_SLUG]) {
    await db.delete(trafficPageviewsTable).where(eq(trafficPageviewsTable.sourceSystem, slug));
    await db.delete(trafficSessionsTable).where(eq(trafficSessionsTable.sourceSystem, slug));
    await db.delete(trafficPropertiesTable).where(eq(trafficPropertiesTable.slug, slug));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

async function postIngest(
  authHeader: string | null,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const res = await fetch(`${baseUrl}/api/traffic/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function makeRow(sessionKey: string, path: string, viewedAt: string) {
  return { sessionKey, path, viewedAt };
}

test("ingest: missing Authorization header → 401", async () => {
  const { status } = await postIngest(null, { rows: [makeRow("s1", "/", new Date().toISOString())] });
  assert.equal(status, 401);
});

test("ingest: non-Bearer Authorization → 401", async () => {
  const { status } = await postIngest("Basic abc", {
    rows: [makeRow("s1", "/", new Date().toISOString())],
  });
  assert.equal(status, 401);
});

test("ingest: Bearer with unknown prefix → 401", async () => {
  const { status } = await postIngest("Bearer tp_doesnotexist_xxxxxxxxxxxxxx", {
    rows: [makeRow("s1", "/", new Date().toISOString())],
  });
  assert.equal(status, 401);
});

test("ingest: prefix matches but key wrong → 401", async () => {
  // Same 8-char prefix, different remainder. We craft the forged key to have
  // the same prefix as `validKey`.
  const forged = validKey.slice(0, 8) + "X".repeat(validKey.length - 8);
  const { status } = await postIngest(`Bearer ${forged}`, {
    rows: [makeRow("s1", "/", new Date().toISOString())],
  });
  assert.equal(status, 401);
});

test("ingest: inactive property's valid key → 401", async () => {
  const { status } = await postIngest(`Bearer ${inactiveKey}`, {
    rows: [makeRow("s1", "/", new Date().toISOString())],
  });
  assert.equal(status, 401);
});

test("ingest: valid key + batch → 202 with propertySlug, rows tagged", async () => {
  const sessionKey = `sess-${randomBytes(4).toString("hex")}`;
  const viewedAt = new Date().toISOString();
  const { status, json } = await postIngest(`Bearer ${validKey}`, {
    rows: [
      makeRow(sessionKey, "/", viewedAt),
      makeRow(sessionKey, "/insights", new Date(Date.now() + 1000).toISOString()),
    ],
  });
  assert.equal(status, 202);
  assert.equal(json.propertySlug, TEST_SLUG);
  assert.equal(json.accepted, 2);
  assert.equal(json.errors, 0);

  const sessions = await db
    .select({ id: trafficSessionsTable.id })
    .from(trafficSessionsTable)
    .where(
      and(
        eq(trafficSessionsTable.sourceSystem, TEST_SLUG),
        eq(trafficSessionsTable.legacySessionKey, sessionKey),
      ),
    );
  assert.equal(sessions.length, 1, "exactly one session row keyed on (slug, sessionKey)");

  const pageviews = await db
    .select({ id: trafficPageviewsTable.id })
    .from(trafficPageviewsTable)
    .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
  assert.equal(pageviews.length, 2, "two pageview rows from the batch");
});

test("ingest: re-posting the same batch is idempotent (duplicates counted, no extra rows)", async () => {
  const sessionKey = `sess-idem-${randomBytes(4).toString("hex")}`;
  const viewedAt = new Date().toISOString();
  const rows = [makeRow(sessionKey, "/about", viewedAt)];

  const first = await postIngest(`Bearer ${validKey}`, { rows });
  assert.equal(first.status, 202);
  assert.equal(first.json.accepted, 1);

  const second = await postIngest(`Bearer ${validKey}`, { rows });
  assert.equal(second.status, 202);
  assert.equal(
    second.json.accepted + second.json.duplicates,
    1,
    "second post must classify the row as a duplicate, not a fresh insert",
  );
  assert.ok(second.json.duplicates >= 1, "duplicates counter incremented");

  const sessions = await db
    .select({ id: trafficSessionsTable.id })
    .from(trafficSessionsTable)
    .where(
      and(
        eq(trafficSessionsTable.sourceSystem, TEST_SLUG),
        eq(trafficSessionsTable.legacySessionKey, sessionKey),
      ),
    );
  assert.equal(sessions.length, 1);

  const pageviews = await db
    .select({ id: trafficPageviewsTable.id })
    .from(trafficPageviewsTable)
    .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
  assert.equal(pageviews.length, 1, "no double-counted pageview after retry");
});

test("ingest: invalid body shape → 400", async () => {
  const { status } = await postIngest(`Bearer ${validKey}`, { rows: [] });
  assert.equal(status, 400);
});

test("ingest: idempotency does not double-bump session pageview_count", async () => {
  // Regression for #228 review: ingestPageviewBatch must NOT increment
  // traffic_sessions.pageview_count when the pageview is a duplicate.
  const sessionKey = `sess-pvc-${randomBytes(4).toString("hex")}`;
  const viewedAt = new Date().toISOString();
  const rows = [makeRow(sessionKey, "/pricing", viewedAt)];

  const r1 = await postIngest(`Bearer ${validKey}`, { rows });
  assert.equal(r1.status, 202);
  const r2 = await postIngest(`Bearer ${validKey}`, { rows });
  assert.equal(r2.status, 202);

  const sessions = await db
    .select({ id: trafficSessionsTable.id, pvc: trafficSessionsTable.pageviewCount })
    .from(trafficSessionsTable)
    .where(
      and(
        eq(trafficSessionsTable.sourceSystem, TEST_SLUG),
        eq(trafficSessionsTable.legacySessionKey, sessionKey),
      ),
    );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.pvc, 1, "duplicate retry must not bump session pageview_count");
});

test("ingest: { pageviews } shape accepted alongside legacy { rows }", async () => {
  const sessionKey = `sess-pv-${randomBytes(4).toString("hex")}`;
  const viewedAt = new Date().toISOString();
  const { status, json } = await postIngest(`Bearer ${validKey}`, {
    pageviews: [makeRow(sessionKey, "/contact", viewedAt)],
  });
  assert.equal(status, 202);
  assert.equal(json.accepted, 1);
  assert.equal(json.rowsParsed, 1);
});

test("ingest: rate limit kicks in after the configured threshold", async () => {
  // The per-key limiter is 60/min. We blast 65 sequential POSTs with a
  // tiny single-row batch and expect at least one 429 toward the tail.
  const sessionKeyBase = `sess-rl-${randomBytes(4).toString("hex")}`;
  let saw429 = false;
  for (let i = 0; i < 65; i++) {
    const { status } = await postIngest(`Bearer ${validKey}`, {
      rows: [makeRow(`${sessionKeyBase}-${i}`, "/", new Date().toISOString())],
    });
    if (status === 429) {
      saw429 = true;
      break;
    }
  }
  assert.ok(saw429, "expected at least one 429 response from per-key rate limit");
});
