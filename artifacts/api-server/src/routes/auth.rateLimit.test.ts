/**
 * Integration tests for the POST /api/auth/register rate limiter.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:auth-rate-limit
 *
 * The limiter lives in `routes/auth.ts` and is keyed on the client IP. We
 * spin up the real Express app on an ephemeral port, vary `X-Forwarded-For`
 * to simulate distinct clients (the app sets `trust proxy: true`), and
 * assert:
 *   1. The 6th register request from a single IP returns 429 with the
 *      registration-specific error message, while the first five drop
 *      through to the route handler (here returning 400 for an empty body).
 *   2. The register limiter's bucket is isolated from the login and
 *      forgot-password limiters — exhausting register's window from IP A
 *      does NOT cause those endpoints to 429 from the same IP.
 *   3. Other IPs are unaffected by IP A's exhausted bucket.
 *   4. A valid registration below the limit still returns 201 with the
 *      `requiresVerification:true` shape.
 *
 * The limiter uses an in-memory store, so each test picks a unique IP to
 * avoid cross-test interference. The limit constants (5/15min, message
 * text) mirror what's in auth.ts; if those change, update both places.
 */
// Disable outbound email BEFORE importing the app, so the fire-and-forget
// sendEmailVerification call inside POST /api/auth/register never reaches
// SendGrid during this integration test. `email.ts::sendEmail` short-circuits
// to `{status:"skipped"}` whenever EMAIL_DISABLED=1.
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app";

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// Generate a unique fake IPv4 per test so each test gets a fresh limiter
// bucket regardless of run order. 203.0.113.0/24 is the TEST-NET-3 reserved
// range (RFC 5737) — guaranteed never to belong to a real host.
let ipCounter = 0;
function nextTestIp(): string {
  ipCounter++;
  if (ipCounter > 250) throw new Error("ran out of test IPs");
  return `203.0.113.${ipCounter}`;
}

async function postJson(
  path: string,
  body: unknown,
  ip: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

test("POST /api/auth/register: 6th request from same IP returns 429 with the register-specific message", async () => {
  const ip = nextTestIp();

  // Five requests with an invalid body — these get past the limiter, fail
  // Zod parsing in the handler, and return 400. Crucially, each one still
  // increments the limiter's counter for this IP.
  for (let i = 0; i < 5; i++) {
    const { status } = await postJson("/api/auth/register", {}, ip);
    assert.equal(
      status,
      400,
      `request #${i + 1} should be a 400 (invalid body), got ${status}`,
    );
  }

  // The 6th request must be rejected by the limiter before reaching the
  // handler.
  const sixth = await postJson("/api/auth/register", {}, ip);
  assert.equal(sixth.status, 429, "6th register request should be rate-limited");
  assert.deepEqual(
    sixth.json,
    {
      error: "Too many registration attempts. Please try again in 15 minutes.",
    },
    "429 body should match the register-specific message",
  );

  // A 7th request should also still be 429 — confirming the limiter stays
  // tripped within the window rather than resetting after firing once.
  const seventh = await postJson("/api/auth/register", {}, ip);
  assert.equal(seventh.status, 429, "7th register request should also be 429");
});

test("register limiter is isolated from login + forgot-password limiters (different bucket keys)", async () => {
  const ip = nextTestIp();

  // Exhaust the register bucket from this IP.
  for (let i = 0; i < 5; i++) {
    await postJson("/api/auth/register", {}, ip);
  }
  const tripped = await postJson("/api/auth/register", {}, ip);
  assert.equal(tripped.status, 429, "register bucket should be tripped");
  assert.match(
    (tripped.json as { error: string }).error,
    /registration/i,
    "tripped response should be the register-specific message",
  );

  // From the SAME IP, hitting /auth/login must not be 429: it lives in a
  // separate `login:` bucket. We send an empty body so the handler responds
  // with a non-429 status (most likely 400 for invalid body) — the exact
  // value isn't important, only that it isn't 429 and isn't carrying the
  // register message.
  const login = await postJson("/api/auth/login", {}, ip);
  assert.notEqual(
    login.status,
    429,
    `login should not be rate-limited by register's bucket (got ${login.status})`,
  );
  if (login.json && typeof login.json === "object" && "error" in login.json) {
    assert.doesNotMatch(
      String((login.json as { error: unknown }).error ?? ""),
      /registration/i,
      "login response should not carry the register error message",
    );
  }

  // Same expectation for /auth/forgot-password (its own `forgot-password:` bucket).
  const forgot = await postJson(
    "/api/auth/forgot-password",
    { email: "nobody@example.invalid" },
    ip,
  );
  assert.notEqual(
    forgot.status,
    429,
    `forgot-password should not be rate-limited by register's bucket (got ${forgot.status})`,
  );
});

test("register limiter buckets are per-IP — a different IP is unaffected by another IP's tripped bucket", async () => {
  const ipA = nextTestIp();
  const ipB = nextTestIp();

  // Trip IP A's bucket.
  for (let i = 0; i < 6; i++) {
    await postJson("/api/auth/register", {}, ipA);
  }
  const aTripped = await postJson("/api/auth/register", {}, ipA);
  assert.equal(aTripped.status, 429, "IP A should be tripped");

  // IP B sending a request right after must not be rate-limited.
  const bResponse = await postJson("/api/auth/register", {}, ipB);
  assert.notEqual(
    bResponse.status,
    429,
    `IP B should be unaffected by IP A's exhausted bucket (got ${bResponse.status})`,
  );
});

test("POST /api/auth/register: valid request below the limit returns 201 with requiresVerification:true", async () => {
  const ip = nextTestIp();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const email = `ratelimit-test-${tag}@example.invalid`;

  const body = {
    email,
    password: "correct horse battery staple",
    displayName: "Rate Limit Test User",
  };

  try {
    const { status, json } = await postJson("/api/auth/register", body, ip);
    assert.equal(status, 201, `valid register should return 201 (got ${status})`);
    assert.deepEqual(
      json,
      { ok: true, requiresVerification: true },
      "valid register response shape should include ok + requiresVerification flags",
    );
  } finally {
    // Clean up the user row we just inserted. FK cascades take care of the
    // email_verification_tokens row.
    await db.delete(usersTable).where(eq(usersTable.email, email));
  }
});
