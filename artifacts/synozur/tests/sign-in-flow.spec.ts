import { test, expect, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  rolesTable,
  userRoles,
  emailVerificationTokensTable,
} from "@workspace/db";

/**
 * Task #119 — Local-auth sign-in / sign-out happy path + variants.
 *
 * Covers:
 *   1. Happy path: register → verify email → sign in → land on /admin → sign out
 *   2. Wrong password → error banner
 *   3. returnTo redirect: /sign-in?returnTo=/admin/insights/posts → land there
 *
 * Each test creates a brand-new local user with a randomized email so it
 * doesn't collide with seeded data or other test runs. The test owns the
 * user end-to-end and removes it (cascading to roles / tokens / sessions)
 * in a `finally` block so a successful run leaves the database clean.
 *
 * Email verification is normally a "click the link in your inbox" flow.
 * We can't read mailboxes from a Playwright runner, so the test reaches
 * into the `email_verification_tokens` table directly to grab the token
 * and POSTs it to `/api/auth/verify-email`. That mirrors what the real
 * verification page does — the only thing skipped is the email round-trip.
 *
 * To exercise `/admin`, the test grants the `admin` role directly to the
 * fresh user (the AdminGate component blocks non-admins from rendering
 * the admin layout). This is the same role the server's bootstrap path
 * grants to the very first user, so we're not exercising any extra
 * privilege escalation surface.
 */

interface TestUser {
  id: string;
  email: string;
  password: string;
}

async function createVerifiedAdminUser(
  request: APIRequestContext,
): Promise<TestUser> {
  const stamp = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const email = `e2e-signin-${stamp}@example.test`;
  const password = `Pw-${stamp}-${Math.random().toString(36).slice(2, 8)}!`;

  // Register through the real API so we exercise the same code path a
  // real user does. Returns 201 and queues an email verification token.
  const registerRes = await request.post("/api/auth/register", {
    data: { email, password, displayName: `E2E ${stamp}` },
  });
  expect(
    registerRes.ok(),
    `register should succeed; got ${registerRes.status()} ${await registerRes.text()}`,
  ).toBeTruthy();

  // Find the row + the unused verification token created above.
  const userRow = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });
  expect(userRow, "registered user should exist in DB").toBeTruthy();
  if (!userRow) throw new Error("unreachable");

  const tokenRow = await db.query.emailVerificationTokensTable.findFirst({
    where: eq(emailVerificationTokensTable.userId, userRow.id),
  });
  expect(tokenRow, "verification token should exist for new user").toBeTruthy();
  if (!tokenRow) throw new Error("unreachable");

  // Hit the public verify-email endpoint — this also creates a session
  // cookie, but we don't carry it because we want to test the sign-in
  // form. The cookie lives on the `request` fixture's context only.
  const verifyRes = await request.post("/api/auth/verify-email", {
    data: { token: tokenRow.token },
  });
  expect(
    verifyRes.ok(),
    `verify-email should succeed; got ${verifyRes.status()}`,
  ).toBeTruthy();

  // Grant admin so /admin renders rather than showing the access-denied
  // gate. Match by name; the seed always provisions the canonical roles.
  const adminRole = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, "admin"),
  });
  expect(adminRole, "admin role should be seeded").toBeTruthy();
  if (!adminRole) throw new Error("unreachable");
  await db
    .insert(userRoles)
    .values({ userId: userRow.id, roleId: adminRole.id })
    .onConflictDoNothing();

  return { id: userRow.id, email, password };
}

async function deleteUser(userId: string): Promise<void> {
  // ON DELETE CASCADE on user_roles, sessions, email_verification_tokens, ...
  // so deleting the user row alone is sufficient cleanup.
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

test.afterAll(async () => {
  // Each test pool connection lives for the whole spec run; close it so
  // Playwright exits cleanly instead of hanging on the open handle.
  await pool.end().catch(() => undefined);
});

test.describe("Local sign-in / sign-out flow", () => {
  test("register → sign in → land on /admin → sign out", async ({
    page,
    request,
  }) => {
    const user = await createVerifiedAdminUser(request);
    try {
      // Sign in with returnTo=/admin so a successful login lands on the
      // admin dashboard — same path a real "Sign in to continue" deep
      // link would take.
      await page.goto(`/sign-in?returnTo=${encodeURIComponent("/admin")}`);

      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(user.password);
      await page.getByTestId("button-sign-in").click();

      // After successful login the page navigates to returnTo (= /admin).
      await page.waitForURL(/\/admin(?:\/|$|\?)/, { timeout: 15_000 });

      // The admin layout's sign-out button is the canonical "I'm in" marker.
      await expect(page.getByTestId("button-sign-out")).toBeVisible({
        timeout: 15_000,
      });

      // /api/auth/me must resolve through the page's cookie jar.
      const me = (await page.request
        .get("/api/auth/me")
        .then((r) => r.json())) as { id?: string; email?: string };
      expect(me.id).toBe(user.id);
      expect(me.email?.toLowerCase()).toBe(user.email.toLowerCase());

      // Sign out and assert the session is gone.
      await page.getByTestId("button-sign-out").click();
      // signOut() in the SPA calls /api/auth/sign-out then navigates home.
      await page.waitForURL(
        (url) => !/\/admin(\/|$)/.test(url.pathname),
        { timeout: 15_000 },
      );
      const meAfter = await page.request.get("/api/auth/me");
      expect(
        meAfter.status(),
        "session should be invalidated after sign-out",
      ).toBe(401);
    } finally {
      await deleteUser(user.id);
    }
  });

  test("wrong password shows the error banner", async ({ page, request }) => {
    const user = await createVerifiedAdminUser(request);
    try {
      await page.goto("/sign-in");
      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(`${user.password}-WRONG`);
      await page.getByTestId("button-sign-in").click();

      const banner = page.getByTestId("sign-in-error");
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toContainText(/invalid/i);

      // Form must still be on /sign-in — no session was created.
      expect(new URL(page.url()).pathname).toBe("/sign-in");
      const me = await page.request.get("/api/auth/me");
      expect(me.status()).toBe(401);
    } finally {
      await deleteUser(user.id);
    }
  });

  test("returnTo redirects to /admin/insights/posts after sign-in", async ({
    page,
    request,
  }) => {
    const user = await createVerifiedAdminUser(request);
    try {
      await page.goto(
        `/sign-in?returnTo=${encodeURIComponent("/admin/insights/posts")}`,
      );
      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(user.password);
      await page.getByTestId("button-sign-in").click();

      await page.waitForURL(/\/admin\/insights\/posts(?:\/|$|\?)/, {
        timeout: 15_000,
      });
      expect(new URL(page.url()).pathname).toBe("/admin/insights/posts");
      await expect(page.getByTestId("button-sign-out")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await deleteUser(user.id);
    }
  });
});

