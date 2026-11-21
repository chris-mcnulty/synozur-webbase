import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as database from "@workspace/db";

let fixtureDb: any = database.db;
await mock.module("@workspace/db", {
  namedExports: { ...database, db: new Proxy(database.db, {
    get(_target, key) {
      const value = Reflect.get(fixtureDb, key);
      return typeof value === "function" ? value.bind(fixtureDb) : value;
    },
  }) },
});
// Customer organization eligibility is covered by portal middleware tests.
await mock.module("../middlewares/requireCustomerAudience", {
  namedExports: { requireCustomerAudience: (_req: unknown, _res: unknown, next: () => void) => next() },
});
await mock.module("../lib/audit", { namedExports: { audit: async () => undefined } });
const { default: router } = await import("./portalMessage");
const rollback = new Error("rollback message fixtures");

test("CEO message permissions, persistence, visibility and validation", async () => {
  await assert.rejects(database.db.transaction(async tx => {
    fixtureDb = tx;
    await tx.delete(database.portalMessageTable);
    const app = express();
    app.use(express.json(), (req, _res, next) => {
      const role = req.get("x-test-role");
      if (role) req.authedUser = {
        id: "00000000-0000-4000-8000-000000000001", authProvider: "local", externalSubject: null,
        email: null, displayName: null, avatarUrl: null, bio: null, roles: [role as "admin"], effectiveCapabilities: [],
      };
      next();
    }, router);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = (path: string, role?: string, body?: unknown) => fetch(base + path, {
      method: body ? "PUT" : "GET",
      headers: { ...(role ? { "x-test-role": role } : {}), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try {
      assert.equal((await request("/admin/portal-message")).status, 401);
      assert.equal((await request("/admin/portal-message", "editor")).status, 403);
      assert.equal((await request("/portal/ceo-message")).status, 401);
      assert.deepEqual(await (await request("/portal/ceo-message", "customer")).json(), { item: null });
      const input = { message: "First paragraph.\n\nSecond paragraph.", signature: "Test CEO", quarterLabel: "Q4 2026", visible: true };
      assert.equal((await request("/admin/portal-message", "customer", input)).status, 403);
      assert.equal((await request("/admin/portal-message", "admin", { ...input, message: " " })).status, 400);
      assert.equal((await request("/admin/portal-message", "admin", { ...input, message: "x".repeat(10001) })).status, 400);
      assert.equal((await request("/admin/portal-message", "admin", input)).status, 200);
      assert.deepEqual(await (await request("/admin/portal-message", "site_admin")).json(), input);
      const visible = await request("/portal/ceo-message", "customer");
      assert.match(visible.headers.get("cache-control")!, /no-store/);
      assert.deepEqual(await visible.json(), { item: input });
      assert.equal((await request("/admin/portal-message", "site_admin", { ...input, visible: false })).status, 200);
      assert.deepEqual(await (await request("/portal/ceo-message", "customer")).json(), { item: null });
      assert.equal((await (await request("/admin/portal-message", "admin")).json() as typeof input).message, input.message);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    throw rollback;
  }), error => error === rollback);
  fixtureDb = database.db;
  await database.pool.end();
});
