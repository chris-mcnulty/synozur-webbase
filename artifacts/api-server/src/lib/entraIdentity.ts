import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import type { NormalizedIdentity } from "./entraOidc";

/** Called only after the upstream ID token has been cryptographically verified. */
export async function findEntraSignInUser(identity: NormalizedIdentity) {
  const bySubject = await db.query.usersTable.findFirst({
    where: and(eq(usersTable.authProvider, "entra"), eq(usersTable.externalSubject, identity.externalSubject)),
  });
  if (bySubject) return bySubject;
  if (identity.entraTenantId && identity.entraObjectId) {
    const byObject = await db.query.usersTable.findFirst({
      where: and(
        eq(usersTable.authProvider, "entra"),
        eq(usersTable.entraTenantId, identity.entraTenantId.toLowerCase()),
        eq(usersTable.entraObjectId, identity.entraObjectId.toLowerCase()),
      ),
    });
    if (byObject) return byObject;
  }
  if (identity.email) {
    const byEmail = await db.query.usersTable.findFirst({ where: eq(usersTable.email, identity.email) });
    // Legacy imported placeholders can link by email. Identity-bound Entra
    // access must never be claimed by a different object or tenant.
    if (byEmail && !byEmail.entraObjectId && (!byEmail.externalSubject || byEmail.authProvider === "imported")) {
      return byEmail;
    }
  }
  return undefined;
}
