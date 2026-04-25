import { eq, lt } from "drizzle-orm";
import { db, authPendingStatesTable } from "@workspace/db";

// Single-use OAuth/OIDC state record. Captures the `state` parameter, the
// PKCE `code_verifier`, the post-auth `returnTo`, and the ID-token `nonce`.
// The row is deleted on successful callback consumption so replay is
// impossible.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function persistAuthPendingState(args: {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string | null;
}): Promise<void> {
  const now = new Date();
  await db.insert(authPendingStatesTable).values({
    state: args.state,
    codeVerifier: args.codeVerifier,
    nonce: args.nonce,
    returnTo: args.returnTo,
    createdAt: now,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
}

export async function consumeAuthPendingState(
  state: string,
): Promise<{ codeVerifier: string; nonce: string; returnTo: string | null } | null> {
  const [row] = await db
    .delete(authPendingStatesTable)
    .where(eq(authPendingStatesTable.state, state))
    .returning();
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return {
    codeVerifier: row.codeVerifier,
    nonce: row.nonce,
    returnTo: row.returnTo,
  };
}

export async function pruneExpiredAuthStates(): Promise<{ deleted: number }> {
  const result = await db
    .delete(authPendingStatesTable)
    .where(lt(authPendingStatesTable.expiresAt, new Date()))
    .returning({ state: authPendingStatesTable.state });
  return { deleted: result.length };
}
