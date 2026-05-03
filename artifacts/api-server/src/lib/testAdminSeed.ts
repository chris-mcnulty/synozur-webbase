import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable, userRoles } from "@workspace/db";
import { logger } from "./logger";

/**
 * Seeds (or refreshes) a local email+password admin account for end-to-end
 * automated testing. Active only when:
 *
 *   - `NODE_ENV` is NOT "production"
 *   - both `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` env vars are set
 *
 * The admin area uses Entra SSO exclusively in production, which the
 * Playwright test runner cannot drive without a service-account credential.
 * This seeder unblocks CI / local automated runs by guaranteeing a verified
 * local admin user exists at startup, with the chosen password and the
 * `admin` role attached. The account is upserted on every startup so a
 * password rotation in the env applies immediately without manual DB edits.
 *
 * No-ops in production and emits a single info log line summarising the
 * outcome so accidental enabling in shared environments is visible.
 */
export async function seedTestAdminIfConfigured(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") return;
  const email = (process.env["E2E_ADMIN_EMAIL"] ?? "").trim().toLowerCase();
  const password = process.env["E2E_ADMIN_PASSWORD"] ?? "";
  if (!email || !password) return;

  // Fail-fast on misconfiguration: if the env vars are set we treat seeding
  // as required and let exceptions propagate. This surfaces a startup error
  // immediately rather than letting a later /admin login mysteriously fail
  // in CI. Operators who don't want this behavior can simply unset the
  // env vars.
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  let userId: string;
  if (existing) {
    await db
      .update(usersTable)
      .set({
        passwordHash,
        authProvider: "local",
        externalSubject: existing.externalSubject ?? `local:${email}`,
        emailVerified: true,
      })
      .where(eq(usersTable.id, existing.id));
    userId = existing.id;
  } else {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        email,
        passwordHash,
        authProvider: "local",
        externalSubject: `local:${email}`,
        displayName: "E2E Test Admin",
        emailVerified: true,
      })
      .returning();
    if (!inserted) {
      throw new Error("Failed to insert E2E test admin user row");
    }
    userId = inserted.id;
  }

  const adminRole = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, "admin"),
  });
  if (!adminRole) {
    throw new Error(
      "E2E test admin seed: 'admin' role missing from roles table — cannot grant admin to the configured E2E user.",
    );
  }
  await db
    .insert(userRoles)
    .values({ userId, roleId: adminRole.id })
    .onConflictDoNothing();

  logger.info(
    { email, hadExisting: !!existing },
    "Seeded E2E test admin user from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD",
  );
}
