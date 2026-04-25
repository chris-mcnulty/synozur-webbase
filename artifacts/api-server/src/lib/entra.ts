import { clerkClient } from "@clerk/express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
  entraGroupRoleMappingsTable,
  type RoleName,
  ROLE_NAMES,
} from "@workspace/db";
import { logger } from "./logger";

// #126: Microsoft Entra SSO
//
// Entra is wired in *through* Clerk: a Clerk Enterprise SSO connection routes
// the @synozur.com email domain to the Entra tenant, and the OIDC token from
// Microsoft is available to us as a Clerk OAuth external account on the user
// record. This module owns:
//   1. Detecting that a Clerk user signed in via Microsoft.
//   2. Resolving the user's Entra group membership via Microsoft Graph.
//   3. Reconciling our `user_roles` rows against the active group→role
//      mappings — including *removing* roles when the group falls away, so
//      Entra offboarding instantly removes CMS access on next sign-in.
//
// The integration is purely additive: with no Entra tenant configured, none
// of this code path runs and the existing Clerk-only auth stays unchanged.

const MS_OAUTH_PROVIDERS = new Set(["oauth_microsoft", "saml_microsoft"]);
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface EntraSignInContext {
  tenantId: string;
  objectId: string;
  groupIds: string[];
}

interface ClerkExternalAccount {
  provider?: string;
  externalId?: string;
  identityProvider?: string;
  publicMetadata?: Record<string, unknown> | null;
}

interface ClerkUserLike {
  externalAccounts?: ClerkExternalAccount[];
  publicMetadata?: Record<string, unknown> | null;
  primaryEmailAddress?: { emailAddress?: string } | null;
}

export function detectEntraIdentity(
  user: ClerkUserLike,
): { tenantId: string; objectId: string } | null {
  // Clerk surfaces enterprise SSO connections on the user's `externalAccounts`
  // list; the tenant id is exposed via the connection's public metadata
  // (configured in the Clerk dashboard at SSO setup time) and the object id
  // arrives as `externalId` on the Microsoft account.
  const accounts = user.externalAccounts ?? [];
  for (const acct of accounts) {
    const provider = acct.provider ?? acct.identityProvider ?? "";
    if (!MS_OAUTH_PROVIDERS.has(provider)) continue;
    const objectId = acct.externalId;
    if (!objectId) continue;
    const meta = (acct.publicMetadata ?? {}) as Record<string, unknown>;
    const tenantId =
      typeof meta["tenantId"] === "string" && (meta["tenantId"] as string).length > 0
        ? (meta["tenantId"] as string)
        : (process.env["ENTRA_TENANT_ID"] ?? "");
    if (!tenantId) {
      logger.warn(
        { objectId },
        "Entra account detected but no tenant id available — set ENTRA_TENANT_ID or attach tenantId to the Clerk SSO connection metadata",
      );
      continue;
    }
    return { tenantId, objectId };
  }
  return null;
}

// Microsoft Graph requires a token with the `User.Read` and `GroupMember.Read.All`
// scopes (or equivalent). Clerk surfaces the user's OAuth access token via
// `clerkClient.users.getUserOauthAccessToken(userId, providerId)`. When the
// SSO connection grants those scopes, the same token can call Graph; when it
// doesn't, we fall back to the app-only token below.
async function getDelegatedGraphToken(clerkUserId: string): Promise<string | null> {
  try {
    const list = await clerkClient.users.getUserOauthAccessToken(
      clerkUserId,
      "oauth_microsoft",
    );
    // Clerk SDK has shifted shape across versions; handle both.
    const tokens = (list as unknown as { data?: Array<{ token?: string }> }).data
      ?? (list as unknown as Array<{ token?: string }>);
    const first = Array.isArray(tokens) ? tokens[0] : undefined;
    return first?.token ?? null;
  } catch (err) {
    logger.warn({ err }, "Clerk getUserOauthAccessToken(microsoft) failed");
    return null;
  }
}

interface AppTokenCache {
  token: string;
  expiresAt: number;
}
let appTokenCache: AppTokenCache | null = null;

async function getAppOnlyGraphToken(tenantId: string): Promise<string | null> {
  const clientId = process.env["ENTRA_APP_CLIENT_ID"];
  const clientSecret = process.env["ENTRA_APP_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;
  const now = Date.now();
  if (appTokenCache && appTokenCache.expiresAt - 60_000 > now) {
    return appTokenCache.token;
  }
  try {
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
      const text = (await res.text()).slice(0, 500);
      logger.warn({ status: res.status, body: text }, "Entra app-only token fetch failed");
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    appTokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  } catch (err) {
    logger.warn({ err }, "Entra app-only token fetch threw");
    return null;
  }
}

async function fetchGroupIds(
  token: string,
  userIdentifier: string,
  asAppOnly: boolean,
): Promise<string[]> {
  // Delegated calls hit /me; app-only calls hit /users/{id}.
  const path = asAppOnly
    ? `/users/${encodeURIComponent(userIdentifier)}/transitiveMemberOf?$select=id&$top=200`
    : `/me/transitiveMemberOf?$select=id&$top=200`;
  const groupIds: string[] = [];
  let next: string | null = `${GRAPH_BASE}${path}`;
  while (next) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      logger.warn({ status: res.status, body: text }, "Graph transitiveMemberOf failed");
      break;
    }
    const json = (await res.json()) as {
      value?: Array<{ id?: string; "@odata.type"?: string }>;
      "@odata.nextLink"?: string | null;
    };
    for (const v of json.value ?? []) {
      // Only true groups — the response also lists directoryRoles.
      if (v.id && (v["@odata.type"] ?? "").endsWith("group")) {
        groupIds.push(v.id);
      } else if (v.id && !v["@odata.type"]) {
        groupIds.push(v.id);
      }
    }
    next = json["@odata.nextLink"] ?? null;
  }
  return groupIds;
}

export async function resolveEntraGroups(
  clerkUserId: string,
  identity: { tenantId: string; objectId: string },
): Promise<string[]> {
  const delegated = await getDelegatedGraphToken(clerkUserId);
  if (delegated) {
    const ids = await fetchGroupIds(delegated, identity.objectId, false);
    if (ids.length > 0) return ids;
  }
  const appOnly = await getAppOnlyGraphToken(identity.tenantId);
  if (appOnly) {
    return await fetchGroupIds(appOnly, identity.objectId, true);
  }
  logger.info(
    { clerkUserId },
    "Entra group resolution skipped — no delegated token and no app-only credentials configured",
  );
  return [];
}

export async function reconcileEntraRoles(
  userId: string,
  groupIds: string[],
  fallbackAdminGroupId: string | null,
): Promise<{ added: RoleName[]; removed: RoleName[] }> {
  // Read the active mapping table.
  const mappings = groupIds.length > 0
    ? await db
        .select({
          entraGroupId: entraGroupRoleMappingsTable.entraGroupId,
          roleId: entraGroupRoleMappingsTable.roleId,
          roleName: rolesTable.name,
        })
        .from(entraGroupRoleMappingsTable)
        .innerJoin(rolesTable, eq(entraGroupRoleMappingsTable.roleId, rolesTable.id))
        .where(inArray(entraGroupRoleMappingsTable.entraGroupId, groupIds))
    : [];

  const targetRoleNames = new Set<RoleName>();
  for (const m of mappings) {
    if (ROLE_NAMES.includes(m.roleName as RoleName)) {
      targetRoleNames.add(m.roleName as RoleName);
    }
  }

  // Backstop: env-configured admin group always grants admin even with an
  // empty mapping table. Useful for bootstrap.
  if (fallbackAdminGroupId && groupIds.includes(fallbackAdminGroupId)) {
    targetRoleNames.add("admin");
  }

  // Read current Entra-derived role grants on this user. We tag Entra-managed
  // grants by inserting through this same code path; to make removal safe we
  // only ever remove role grants whose role currently maps from *some* Entra
  // group in the mapping table. This way a user manually granted a role in
  // /admin/access/users keeps it even if they have no Entra grant for it.
  const allMappedRoleRows = await db
    .select({ roleId: entraGroupRoleMappingsTable.roleId, roleName: rolesTable.name })
    .from(entraGroupRoleMappingsTable)
    .innerJoin(rolesTable, eq(entraGroupRoleMappingsTable.roleId, rolesTable.id));
  const entraManagedRoleIds = new Set(allMappedRoleRows.map((r) => r.roleId));

  const currentGrants = await db
    .select({ roleId: userRoles.roleId, roleName: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(userRoles.roleId, rolesTable.id))
    .where(eq(userRoles.userId, userId));

  const currentByName = new Map<string, string>();
  for (const g of currentGrants) currentByName.set(g.roleName, g.roleId);

  const targetRoleIds = new Map<string, string>();
  if (targetRoleNames.size > 0) {
    const targetRows = await db
      .select({ id: rolesTable.id, name: rolesTable.name })
      .from(rolesTable)
      .where(inArray(rolesTable.name, [...targetRoleNames]));
    for (const r of targetRows) targetRoleIds.set(r.name, r.id);
  }

  const added: RoleName[] = [];
  const removed: RoleName[] = [];

  for (const [name, roleId] of targetRoleIds) {
    if (!currentByName.has(name)) {
      await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
      added.push(name as RoleName);
    }
  }

  for (const grant of currentGrants) {
    const isEntraManaged = entraManagedRoleIds.has(grant.roleId);
    if (!isEntraManaged) continue;
    if (targetRoleIds.has(grant.roleName)) continue;
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, grant.roleId)));
    if (ROLE_NAMES.includes(grant.roleName as RoleName)) {
      removed.push(grant.roleName as RoleName);
    }
  }

  return { added, removed };
}

export async function applyEntraSignIn(
  clerkUserId: string,
  userId: string,
  clerkUser: ClerkUserLike,
  fallbackAdminGroupId: string | null,
): Promise<EntraSignInContext | null> {
  const identity = detectEntraIdentity(clerkUser);
  if (!identity) return null;
  let groups: string[] = [];
  try {
    groups = await resolveEntraGroups(clerkUserId, identity);
  } catch (err) {
    logger.warn({ err, clerkUserId }, "Entra group resolution threw");
  }

  await db
    .update(usersTable)
    .set({
      entraTenantId: identity.tenantId,
      entraObjectId: identity.objectId,
      entraGroupClaims: groups,
      entraGroupsRefreshedAt: new Date(),
      lastSsoProvider: "entra",
    })
    .where(eq(usersTable.id, userId));

  try {
    const result = await reconcileEntraRoles(userId, groups, fallbackAdminGroupId);
    if (result.added.length > 0 || result.removed.length > 0) {
      logger.info(
        {
          clerkUserId,
          userId,
          objectId: identity.objectId,
          added: result.added,
          removed: result.removed,
        },
        "Entra role reconciliation applied",
      );
    }
  } catch (err) {
    logger.warn({ err, userId }, "Entra role reconciliation failed");
  }

  return { ...identity, groupIds: groups };
}
