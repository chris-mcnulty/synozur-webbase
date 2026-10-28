import { afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { ProvisionEntraUserBody } from "@workspace/api-zod";
import { findEntraSignInUser } from "./entraIdentity";
import { reconcileEntraRoles } from "./entra";
import { EntraProvisionError, provisionEntraUser } from "./provisionEntraUser";
import type { NormalizedIdentity } from "./entraOidc";

afterEach(() => mock.restoreAll());
const tenant = "11111111-1111-4111-8111-111111111111";
const object = "22222222-2222-4222-8222-222222222222";
const identity: NormalizedIdentity = {
  externalSubject: "verified-subject", entraTenantId: tenant, entraObjectId: object,
  email: "editor@example.invalid", displayName: "Test editor", avatarUrl: null,
};

test("provision contract only allows editorial roles and valid identity fields", () => {
  const valid = { email: identity.email, objectId: object, roles: ["editor", "content_author"] };
  assert.equal(ProvisionEntraUserBody.safeParse(valid).success, true);
  for (const roles of [[], ["admin"], ["site_admin"], ["author"], ["contributor"]]) {
    assert.equal(ProvisionEntraUserBody.safeParse({ ...valid, roles }).success, false);
  }
  assert.equal(ProvisionEntraUserBody.safeParse({ ...valid, objectId: "not-an-object" }).success, false);
  assert.equal(ProvisionEntraUserBody.safeParse({ ...valid, email: "invalid" }).success, false);
});

test("verified subject continues using the existing account", async () => {
  const existing = { id: "existing" };
  const lookup = mock.method(db.query.usersTable, "findFirst", async () => existing as never);
  assert.equal(await findEntraSignInUser(identity), existing);
  assert.equal(lookup.mock.callCount(), 1);
});

test("first sign-in finds prepared access by tenant and object, even if email changed", async () => {
  const prepared = { id: "prepared" };
  let count = 0;
  const lookup = mock.method(db.query.usersTable, "findFirst", async () => (++count === 2 ? prepared : undefined) as never);
  assert.equal(await findEntraSignInUser({ ...identity, email: "new@example.invalid" }), prepared);
  const predicate = lookup.mock.calls[1].arguments[0]!.where!;
  const query = new PgDialect().sqlToQuery(predicate as never);
  assert.deepEqual(query.params, ["entra", tenant, object]);
});

test("same email cannot claim a prepared account for a different tenant or object", async () => {
  for (const changed of [{ entraTenantId: "other-tenant" }, { entraObjectId: "other-object" }]) {
    let count = 0;
    mock.method(db.query.usersTable, "findFirst", async () => (++count === 3
      ? { id: "prepared", entraObjectId: object, externalSubject: null, authProvider: "entra" }
      : undefined) as never);
    assert.equal(await findEntraSignInUser({ ...identity, ...changed }), undefined);
    mock.restoreAll();
  }
});

test("legacy imported placeholder linking still works", async () => {
  const legacy = { id: "legacy", authProvider: "imported", externalSubject: null, entraObjectId: null };
  let count = 0;
  mock.method(db.query.usersTable, "findFirst", async () => (++count === 3 ? legacy : undefined) as never);
  assert.equal(await findEntraSignInUser(identity), legacy);
});

test("missing oid and tid cannot claim an identity-bound record via email", async () => {
  let count = 0;
  mock.method(db.query.usersTable, "findFirst", async () => (++count === 2
    ? { entraObjectId: object, externalSubject: null, authProvider: "entra" } : undefined) as never);
  assert.equal(await findEntraSignInUser({ ...identity, entraTenantId: null, entraObjectId: null }), undefined);
});

test("group refresh preserves explicit assignments but removes stale group-managed grants", async () => {
  let selections = 0;
  mock.method(db, "select", (() => {
    const rows = ++selections === 1
      ? [{ roleId: "manual-editor", roleName: "editor" }, { roleId: "group-author", roleName: "content_author" }]
      : [
        { roleId: "manual-editor", roleName: "editor", manuallyAssigned: true },
        { roleId: "group-author", roleName: "content_author", manuallyAssigned: false },
      ];
    const chain = { from: () => chain, innerJoin: () => chain, where: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve) };
    return chain;
  }) as unknown as typeof db.select);
  const predicates: unknown[] = [];
  mock.method(db, "delete", (() => ({ where: async (predicate: unknown) => { predicates.push(predicate); } })) as unknown as typeof db.delete);
  const result = await reconcileEntraRoles("test-user", [], null);
  assert.deepEqual(result, { added: [], removed: ["content_author"] });
  assert.equal(predicates.length, 1);
  const query = new PgDialect().sqlToQuery(predicates[0] as never);
  assert.deepEqual(query.params, ["test-user", "group-author"]);
});

test("invalid input is rejected before any database transaction", async () => {
  const transaction = mock.method(db, "transaction");
  await assert.rejects(provisionEntraUser({ email: "no", roles: ["admin"] }),
    err => err instanceof EntraProvisionError && err.status === 400);
  assert.equal(transaction.mock.callCount(), 0);
});

test("manual Object ID provisioning creates an unclaimed Entra record and explicit role grants atomically", async () => {
  // Use only a synthetic tenant; no credentials or directory requests are needed.
  const originalTenant = process.env.ENTRA_TENANT_ID;
  process.env.ENTRA_TENANT_ID = tenant;
  try {
    const writes: Array<{ table: string; values: unknown }> = [];
    let selects = 0;
    const tx = {
      execute: async () => {},
      select: () => {
        const chain = { from: () => chain, where: () => chain, limit: async () => [],
          then: (resolve: (value: unknown) => void) => Promise.resolve(++selects === 1
            ? [{ id: "editor-role", name: "editor" }] : []).then(resolve) };
        return chain;
      },
      insert: () => ({
        values: (values: unknown) => {
          writes.push({ table: writes.length === 0 ? "users" : "user_roles", values });
          return { returning: async () => [{
            id: "new-user", ...(values as object), externalSubject: null,
            avatarUrl: null, createdAt: new Date("2026-01-01"),
          }], then: (resolve: (value: unknown) => void) => Promise.resolve(undefined).then(resolve) };
        },
      }),
    };
    mock.method(db, "transaction", (async (callback: (tx: unknown) => unknown) => callback(tx)) as unknown as typeof db.transaction);
    const result = await provisionEntraUser({ email: "EDITOR@example.invalid", objectId: object, roles: ["editor"] });
    assert.equal(result.email, "editor@example.invalid");
    assert.equal(result.externalSubject, null);
    assert.deepEqual(writes[0].values, {
      email: "editor@example.invalid", displayName: null,
      authProvider: "entra", entraTenantId: tenant, entraObjectId: object,
    });
    assert.deepEqual(writes[1].values, [{ userId: "new-user", roleId: "editor-role", manuallyAssigned: true }]);
  } finally {
    if (originalTenant === undefined) delete process.env.ENTRA_TENANT_ID;
    else process.env.ENTRA_TENANT_ID = originalTenant;
  }
});
