import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable, userRoles, rolesTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createSession, destroySession } from "./sessions";
import { findEntraSignInUser } from "./entraIdentity";
import { reconcileEntraRoles } from "./entra";
import { ListCmsUsersResponseItem, ListCmsUsersResponse, SetCmsUserRolesResponse } from "@workspace/api-zod";

// Explicitly opt in against a running development API; never run in production.
test("dev API enforces provisioning permissions, identity binding and durable role assignments", {
  skip: process.env.RUN_ENTRA_INTEGRATION !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const ids: string[] = [];
  const sessions: string[] = [];
  let targetEmail: string | undefined;
  const suffix = randomUUID();
  const endpoint = "http://localhost:8080/api/cms/users";
  try {
    const roleRows = await db.select().from(rolesTable);
    async function actor(role: "site_admin" | "editor" | "author") {
      const [user] = await db.insert(usersTable).values({
        email: `entra-check-${role}-${suffix}@example.invalid`, authProvider: "local",
      }).returning();
      ids.push(user.id);
      await db.insert(userRoles).values({ userId: user.id, roleId: roleRows.find(row => row.name === role)!.id });
      const session = await createSession({ userId: user.id, userAgent: "dev-entra-provision-check", ip: null });
      sessions.push(session.token);
      return session.token;
    }
    async function request(method: string, url: string, data?: unknown, token?: string) {
      return fetch(url, {
        method, headers: { "content-type": "application/json", ...(token ? { cookie: `sid=${token}` } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    }
    const admin = await actor("site_admin"), editor = await actor("editor"), guest = await actor("author");
    const [noRoles] = await db.insert(usersTable).values({
      email: `no-roles-${suffix}@example.invalid`, authProvider: "entra", entraObjectId: randomUUID(),
    }).returning();
    ids.push(noRoles.id);
    assert.equal((await request("GET", `${endpoint}?scope=all`)).status, 401);
    assert.equal((await request("GET", `${endpoint}?scope=all`, undefined, editor)).status, 403);
    assert.equal((await request("GET", `${endpoint}?scope=all`, undefined, guest)).status, 403);
    assert.equal((await request("GET", `${endpoint}?scope=invalid`, undefined, admin)).status, 400);
    const allUsers = ListCmsUsersResponse.parse(await (await request("GET", `${endpoint}?scope=all`, undefined, admin)).json());
    assert.ok(allUsers.some(user => user.id === noRoles.id && user.roles.length === 0));
    const contentUsers = ListCmsUsersResponse.parse(await (await request("GET", endpoint, undefined, admin)).json());
    assert.ok(!contentUsers.some(user => user.id === noRoles.id));
    // Existing email requires no Object ID or Graph lookup, and points to the
    // exact no-role account so the administrator can edit rather than duplicate.
    const existingResponse = await request("POST", endpoint, { email: noRoles.email!.toUpperCase(), roles: ["editor"] }, admin);
    assert.equal(existingResponse.status, 409);
    assert.equal((await existingResponse.json() as { existingUserId: string }).existingUserId, noRoles.id);
    const assignExisting = await request("PUT", `${endpoint}/${noRoles.id}/roles`, { roles: ["content_author"] }, admin);
    assert.equal(assignExisting.status, 200);
    const existingGranted = ListCmsUsersResponse.parse(await (await request("GET", `${endpoint}?scope=all`, undefined, admin)).json());
    assert.ok(existingGranted.some(user => user.id === noRoles.id && user.roles.includes("content_author")));
    const body = {
      email: `prepared-${suffix}@example.invalid`, displayName: "Temporary provisioning test",
      objectId: randomUUID(), roles: ["editor", "content_author"],
    };
    targetEmail = body.email;
    assert.equal((await request("POST", endpoint, body)).status, 401);
    assert.equal((await request("POST", endpoint, body, editor)).status, 403);
    assert.equal((await request("POST", endpoint, body, guest)).status, 403);
    const created = await request("POST", endpoint, body, admin);
    const payload = await created.json();
    assert.equal(created.status, 201, JSON.stringify(payload));
    const result = ListCmsUsersResponseItem.parse(payload);
    ids.push(result.id);
    assert.equal(result.externalSubject, null);
    const list = ListCmsUsersResponse.parse(await (await request("GET", endpoint, undefined, admin)).json());
    assert.ok(list.some(user => user.id === result.id && user.roles.includes("editor")));
    assert.equal((await request("POST", endpoint, { ...body, email: body.email.toUpperCase() }, admin)).status, 409);
    const identityConflict = await request("POST", endpoint, { ...body, email: `other-${suffix}@example.invalid` }, admin);
    assert.equal(identityConflict.status, 409);
    assert.equal((await identityConflict.json() as { existingUserId: string }).existingUserId, result.id);
    const row = await db.query.usersTable.findFirst({ where: eq(usersTable.id, result.id) });
    const identity = {
      externalSubject: `verified-${suffix}`, entraTenantId: row!.entraTenantId, entraObjectId: body.objectId,
      email: `renamed-${suffix}@example.invalid`, displayName: null, avatarUrl: null,
    };
    assert.equal((await findEntraSignInUser(identity))!.id, result.id);
    assert.equal(await findEntraSignInUser({ ...identity, entraTenantId: randomUUID(), email: body.email }), undefined);
    assert.deepEqual((await reconcileEntraRoles(result.id, [], null)).removed, []);
    const changed = await request("PUT", `${endpoint}/${result.id}/roles`, { roles: ["editor"] }, admin);
    assert.equal(changed.status, 200);
    assert.deepEqual(SetCmsUserRolesResponse.parse(await changed.json()).roles, ["editor"]);
    const grants = await db.select().from(userRoles).where(eq(userRoles.userId, result.id));
    assert.equal(grants.length, 1);
    assert.equal(grants[0].manuallyAssigned, true);
    const removed = await request("PUT", `${endpoint}/${result.id}/roles`, { roles: [] }, admin);
    assert.equal(removed.status, 200);
    const afterRemoval = ListCmsUsersResponse.parse(await (await request("GET", `${endpoint}?scope=all`, undefined, admin)).json());
    assert.ok(afterRemoval.some(user => user.id === result.id && user.roles.length === 0));
  } finally {
    if (targetEmail) {
      const leftovers = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, targetEmail));
      ids.push(...leftovers.map(row => row.id));
    }
    for (const token of sessions) await destroySession(token);
    if (ids.length) {
      await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, ids));
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
    await pool.end();
  }
});
