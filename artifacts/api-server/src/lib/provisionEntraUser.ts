import { and, eq, or, sql } from "drizzle-orm";
import { db, rolesTable, usersTable, userRoles } from "@workspace/db";
import { ProvisionEntraUserBody } from "@workspace/api-zod";
import { tenantAuthority } from "./entraOidc";
import { lookupEntraUser } from "./entra";

export class EntraProvisionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function provisionEntraUser(body: unknown) {
  const parsed = ProvisionEntraUserBody.safeParse(body);
  if (!parsed.success) throw new EntraProvisionError(400, "Enter a valid work email, name and at least one editorial role. Object ID must be a UUID when provided.");
  const input = parsed.data;
  const tenantId = tenantAuthority();
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(tenantId)) throw new EntraProvisionError(503, "A specific Entra tenant ID must be configured before preparing internal website access.");
  const email = input.email.trim().toLowerCase();
  let objectId = input.objectId?.toLowerCase();
  let displayName = input.displayName?.trim();
  if (!objectId) {
    try {
      const directoryUser = await lookupEntraUser(tenantId, email);
      objectId = directoryUser.id.toLowerCase();
      displayName ||= directoryUser.displayName;
    } catch (err) {
      throw new EntraProvisionError(503, err instanceof Error ? err.message : "Directory lookup failed. Enter the user's Entra Object ID.");
    }
  }
  if (!guid.test(objectId)) throw new EntraProvisionError(400, "A valid Entra Object ID is required.");
  const roles = [...new Set(input.roles)];
  return db.transaction(async (tx) => {
    // Serialize concurrent provisioning attempts; neither email nor directory
    // identity has a unique constraint in the legacy users table.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cms-entra-provision'))`);
    const existing = await tx.select({ id: usersTable.id }).from(usersTable).where(or(
      sql`lower(${usersTable.email}) = ${email}`,
      and(eq(usersTable.entraTenantId, tenantId), eq(usersTable.entraObjectId, objectId!)),
    )).limit(1);
    if (existing.length) throw new EntraProvisionError(409, "This email or Entra identity already has a website record. Edit its roles in Users & Roles instead.");
    const roleRows = await tx.select().from(rolesTable);
    const wanted = roleRows.filter(r => roles.includes(r.name as typeof roles[number]));
    if (wanted.length !== roles.length) throw new EntraProvisionError(503, "The editorial roles are not configured on this site.");
    const [user] = await tx.insert(usersTable).values({
      authProvider: "entra", entraTenantId: tenantId.toLowerCase(), entraObjectId: objectId,
      email, displayName: displayName || null,
    }).returning();
    await tx.insert(userRoles).values(wanted.map(role => ({
      userId: user.id, roleId: role.id, manuallyAssigned: true,
    })));
    return {
      id: user.id, email: user.email, displayName: user.displayName,
      authProvider: user.authProvider, externalSubject: user.externalSubject,
      avatarUrl: user.avatarUrl, roles, createdAt: user.createdAt.toISOString(),
    };
  });
}
