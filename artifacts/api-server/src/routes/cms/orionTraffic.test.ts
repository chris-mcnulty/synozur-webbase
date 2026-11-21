import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

let calls = 0;
await mock.module("../../lib/orion", { namedExports: {
  readOrionTraffic: async (from: string, to: string, refresh: boolean) => {
    calls++;
    return { from, to, refresh };
  },
} });
const { default: router } = await import("./orionTraffic");
const { pool } = await import("@workspace/db");

test("Orion reporting permissions and date contract", async () => {
  const app = express();
  app.use((req, _res, next) => {
    const role = req.headers["x-test-role"];
    if (role) req.authedUser = {
      id: "fixture", authProvider: "entra", externalSubject: null,
      email: null, displayName: null, avatarUrl: null, bio: null,
      roles: [role as "admin"], effectiveCapabilities: [],
    };
    next();
  });
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cms/traffic/orion`;
  const params = "?from=2026-11-01T00%3A00%3A00%2B00%3A00&to=2026-11-20T23%3A59%3A59.999Z&refresh=true";
  const request = (query: string, role?: string) => fetch(base + query, { headers: role ? { "x-test-role": role } : {} });
  try {
    assert.equal((await request(params)).status, 401);
    for (const role of ["customer", "guest_author", "content_author", "internal"]) {
      assert.equal((await request(params, role)).status, 403);
    }
    assert.equal(calls, 0);
    for (const role of ["admin", "site_admin", "editor"]) {
      const response = await request(params, role);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        from: "2026-11-01T00:00:00.000Z", to: "2026-11-20T23:59:59.999Z", refresh: true,
      });
    }
    for (const query of ["", "?from=bad&to=bad", "?from=2026-11-20T00:00:00Z&to=2026-11-01T00:00:00Z", "?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z"]) {
      assert.equal((await request(query, "admin")).status, 400);
    }
    assert.equal(calls, 3);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
