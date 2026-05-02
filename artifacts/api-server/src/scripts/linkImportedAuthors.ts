/**
 * Resolve placeholder users created by the imported-author flow against
 * Microsoft Graph and rewrite them to real Entra identities. The OIDC
 * callback already does this for any imported author who eventually signs
 * in, but authors who never sign in stay as `auth_provider="imported"`
 * forever and never gain a working sign-in path.
 *
 * For each user with `auth_provider = 'imported'` and a non-null email,
 * queries `GET /users?$filter=mail eq '…'` (with a fallback to
 * `userPrincipalName eq '…'` for accounts whose `mail` attribute is unset)
 * against the Synozur tenant. When a match is found the row is rewritten:
 *   - external_subject  → the Entra object id (Graph `id`)
 *   - entra_object_id   → the Entra object id (mirror)
 *   - entra_tenant_id   → ENTRA_TENANT_ID
 *   - auth_provider     → "entra"
 *
 * Uses the same app-only credential plumbing as the runtime sign-in path
 * (`ENTRA_TENANT_ID` + `ENTRA_APP_CLIENT_ID` + `ENTRA_APP_CLIENT_SECRET`,
 * `User.Read.All` application permission with admin consent).
 *
 * Idempotent. Defaults to a dry-run; pass --apply to write.
 *
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/linkImportedAuthors.ts                # dry-run
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/linkImportedAuthors.ts -- --apply     # write
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool, usersTable, auditLogTable } from "@workspace/db";

const APPLY = process.argv.includes("--apply");
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphUser {
  id: string;
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
}

async function getAppToken(tenantId: string): Promise<string> {
  const clientId = process.env["ENTRA_APP_CLIENT_ID"];
  const clientSecret =
    process.env["ENTRA_CLIENT_SECRET"] ?? process.env["ENTRA_APP_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "ENTRA_APP_CLIENT_ID and ENTRA_APP_CLIENT_SECRET (or ENTRA_CLIENT_SECRET) must be set",
    );
  }
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Token fetch failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token in token response");
  return json.access_token;
}

async function findGraphUserByEmail(
  token: string,
  email: string,
): Promise<GraphUser | null> {
  // Quote-escape per OData: a single quote inside the literal is doubled.
  const filter = `mail eq '${email.replace(/'/g, "''")}' or userPrincipalName eq '${email.replace(/'/g, "''")}'`;
  const url = `${GRAPH_BASE}/users?$filter=${encodeURIComponent(filter)}&$select=id,mail,userPrincipalName,displayName&$top=2`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
  });
  if (!res.ok) {
    throw new Error(
      `Graph lookup failed for ${email}: ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { value?: GraphUser[] };
  const matches = json.value ?? [];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // Prefer the row whose `mail` exactly matches; otherwise return the first
    // and let the caller log the ambiguity.
    const exact = matches.find((m) => m.mail?.toLowerCase() === email.toLowerCase());
    return exact ?? matches[0];
  }
  return matches[0];
}

async function main(): Promise<void> {
  const tenantId = process.env["ENTRA_TENANT_ID"];
  if (!tenantId) {
    console.error("ENTRA_TENANT_ID must be set");
    process.exit(2);
  }

  const placeholders = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      externalSubject: usersTable.externalSubject,
    })
    .from(usersTable)
    .where(
      and(eq(usersTable.authProvider, "imported"), isNotNull(usersTable.email)),
    );

  if (placeholders.length === 0) {
    console.log("No imported placeholders with an email — nothing to do.");
    await pool.end();
    return;
  }

  console.log(
    `Resolving ${placeholders.length} imported placeholder(s) against tenant ${tenantId}…`,
  );
  if (!APPLY) {
    console.log("(dry-run — pass --apply to write changes)");
  }

  const token = await getAppToken(tenantId);
  let linked = 0;
  let unmatched = 0;
  let errored = 0;

  for (const user of placeholders) {
    const email = user.email;
    if (!email) continue;
    try {
      const match = await findGraphUserByEmail(token, email);
      if (!match) {
        unmatched++;
        console.log(`  · ${email}: no Graph match`);
        continue;
      }
      console.log(
        `  ✓ ${email} → ${match.id} (${match.displayName ?? "(no name)"})`,
      );
      if (!APPLY) continue;

      await db
        .update(usersTable)
        .set({
          externalSubject: match.id,
          entraObjectId: match.id,
          entraTenantId: tenantId,
          authProvider: "entra",
        })
        .where(eq(usersTable.id, user.id));
      await db.insert(auditLogTable).values({
        actorId: user.id,
        action: "user.import.link-entra",
        entity: "user",
        entityId: user.id,
        diffJson: {
          email,
          previousSubject: user.externalSubject,
          entraObjectId: match.id,
          tenantId,
        } as never,
      });
      linked++;
    } catch (err) {
      errored++;
      console.error(`  ✗ ${email}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone. linked=${linked} unmatched=${unmatched} errored=${errored} (apply=${APPLY})`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
