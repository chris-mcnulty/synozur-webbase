/**
 * Pre-link placeholder users created by the imported-author flow to their
 * real Entra directory entries via Microsoft Graph, so `/admin/access/users`
 * can show their org context (groups, tenant, object id) before they ever
 * sign in. The OIDC callback already absorbs imported placeholders on first
 * sign-in via its email-fallback path, but authors who never sign in stay
 * as bare `auth_provider="imported"` rows with no directory linkage.
 *
 * For each user with `auth_provider = 'imported'` and a non-null email,
 * queries `GET /users?$filter=mail eq '…' or userPrincipalName eq '…'`
 * against the Synozur tenant. When a match is found the row is updated:
 *   - entra_object_id   → the Graph `id` (directory object id, the `oid`
 *                         claim Entra delivers — distinct from the OIDC
 *                         `sub` claim that the callback writes to
 *                         `external_subject` on first real sign-in)
 *   - entra_tenant_id   → ENTRA_TENANT_ID
 *
 * `external_subject` is intentionally NOT touched. Pre-populating it with
 * the object id would cause the callback's `(auth_provider,
 * external_subject)` lookup to miss the row on first sign-in (since the
 * `sub` claim is opaque per-app and not equal to the object id) and
 * create a duplicate user. Leaving `auth_provider = 'imported'` keeps
 * the row visible to the callback's email-fallback branch in
 * `routes/auth.ts`, which writes the real `sub` to `external_subject`
 * at sign-in time and flips the provider to `entra`.
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
      // Count the match before the dry-run early-exit so the summary
      // reflects "would-link" totals an operator can act on.
      linked++;
      if (!APPLY) continue;

      // Deliberately do NOT overwrite `external_subject` here. For Entra
      // users `external_subject` is the OIDC `sub` claim (per-app, opaque,
      // delivered in the ID token at sign-in), not the directory object id.
      // Pre-populating it with `match.id` would cause the OIDC callback's
      // `(auth_provider, external_subject)` lookup to miss the row on
      // first sign-in and create a duplicate user instead of upgrading
      // this placeholder. Leave `auth_provider = 'imported'` so the
      // callback's email-fallback path (`byEmail && (!externalSubject ||
      // authProvider === 'imported')`) absorbs the row and writes the
      // real `sub` at sign-in time. We still populate `entra_object_id`
      // and `entra_tenant_id` so admin queries (group reconciliation,
      // /admin/access/users provider filter) can match the row in
      // advance of first sign-in.
      await db
        .update(usersTable)
        .set({
          entraObjectId: match.id,
          entraTenantId: tenantId,
        })
        .where(eq(usersTable.id, user.id));
      await db.insert(auditLogTable).values({
        actorId: user.id,
        action: "user.import.link-entra",
        entity: "user",
        entityId: user.id,
        diffJson: {
          email,
          entraObjectId: match.id,
          tenantId,
        } as never,
      });
    } catch (err) {
      errored++;
      console.error(`  ✗ ${email}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\nDone. ${APPLY ? "linked" : "would-link"}=${linked} unmatched=${unmatched} errored=${errored} (apply=${APPLY})`,
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
