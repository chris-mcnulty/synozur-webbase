import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  userRoles,
  entraGroupRoleMappingsTable,
  siteSettingsTable,
  type RoleName,
  ROLE_NAMES,
} from "@workspace/db";
import { logger } from "./logger";

// #126: Microsoft Entra group reconciliation.
//
// Identity now lands here from the native OIDC flow in `entraOidc.ts`, not
// from Clerk. After the ID token is verified and the user row is upserted in
// `routes/auth.ts`, we call `applyEntraSignIn` to:
//   1. Mirror tenant + object id onto the user row (idempotent).
//   2. Resolve the user's transitive group membership via Microsoft Graph
//      (app-only credential — `ENTRA_APP_CLIENT_ID` + `ENTRA_APP_CLIENT_SECRET`
//      with the `GroupMember.Read.All` application permission).
//   3. Reconcile `user_roles` against the active `entra_group_role_mappings`
//      rows — adding new grants and removing any role grant that was sourced
//      from a group the user no longer belongs to.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

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

async function fetchGroupIds(token: string, objectId: string): Promise<string[]> {
  const groupIds: string[] = [];
  let next: string | null =
    `${GRAPH_BASE}/users/${encodeURIComponent(objectId)}/transitiveMemberOf?$select=id&$top=200`;
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
  tenantId: string,
  objectId: string,
): Promise<string[]> {
  const token = await getAppOnlyGraphToken(tenantId);
  if (!token) {
    logger.info(
      { objectId },
      "Entra group resolution skipped — no app-only credentials configured (set ENTRA_APP_CLIENT_ID and ENTRA_APP_CLIENT_SECRET with GroupMember.Read.All)",
    );
    return [];
  }
  return fetchGroupIds(token, objectId);
}

export async function reconcileEntraRoles(
  userId: string,
  groupIds: string[],
  fallbackAdminGroupId: string | null,
): Promise<{ added: RoleName[]; removed: RoleName[] }> {
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

  // Read all role-ids that are *currently* sourced from any Entra group, so
  // we know which grants are safe to remove on offboarding without disturbing
  // manually-granted roles in /admin/access/users.
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

export interface ApplyEntraSignInArgs {
  userId: string;
  tenantId: string | null;
  objectId: string | null;
}

export async function applyEntraSignIn(args: ApplyEntraSignInArgs): Promise<void> {
  if (!args.tenantId || !args.objectId) return;

  let groups: string[] = [];
  try {
    groups = await resolveEntraGroups(args.tenantId, args.objectId);
  } catch (err) {
    logger.warn({ err, userId: args.userId }, "Entra group resolution threw");
  }

  await db
    .update(usersTable)
    .set({
      entraTenantId: args.tenantId,
      entraObjectId: args.objectId,
      entraGroupClaims: groups,
      entraGroupsRefreshedAt: new Date(),
      lastSsoProvider: "entra",
    })
    .where(eq(usersTable.id, args.userId));

  const settings = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, 1),
  });
  if (settings && settings.entraEnabled === false) return;

  try {
    const result = await reconcileEntraRoles(
      args.userId,
      groups,
      settings?.entraAdminGroupFallback ?? null,
    );
    if (result.added.length > 0 || result.removed.length > 0) {
      logger.info(
        {
          userId: args.userId,
          objectId: args.objectId,
          added: result.added,
          removed: result.removed,
        },
        "Entra role reconciliation applied",
      );
    }
  } catch (err) {
    logger.warn({ err, userId: args.userId }, "Entra role reconciliation failed");
  }
}
