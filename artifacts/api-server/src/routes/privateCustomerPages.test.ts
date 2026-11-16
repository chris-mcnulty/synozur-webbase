import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "@workspace/db";
import { migratePrivateCustomerPages } from "../lib/privatePages/migration";
import { attachSharedAccess } from "../lib/privatePages/sharedAccess";
import { attachUserIfPresent, loadUserById } from "../middlewares/auth";
import privatePages from "./privateCustomerPages";
import sharedAccounts from "./sharedOrganizationAccess";
import { speFileStorage } from "../lib/storage/spe/fileStorage";
import { signAccessToken } from "../lib/oauthTokens";
import { GetPrivateCustomerPageResponse } from "@workspace/api-zod";

test("private page and shared-account HTTP security lifecycle", async (t) => {
  await migratePrivateCustomerPages();
  const orgA = randomUUID(), orgB = randomUUID(), staff = randomUUID(), member = randomUUID(), outsider = randomUUID();
  const files = new Map<string, Buffer>();
  const originalStore = speFileStorage.storeFile, originalGet = speFileStorage.getFile;
  speFileStorage.storeFile = async (opts) => {
    const itemId = randomUUID(); files.set(itemId, opts.body);
    return { containerId: "test-private-container", itemId, size: opts.body.length, contentType: opts.contentType };
  };
  speFileStorage.getFile = async (id) => new Response(new Uint8Array(files.get(id) ?? Buffer.alloc(0)));
  await pool.query("INSERT INTO client_organizations(id,name,slug,is_active) VALUES($1,'Synthetic private A',$3,true),($2,'Synthetic private B',$4,true)",
    [orgA, orgB, `test-${orgA}`, `test-${orgB}`]);
  await pool.query("INSERT INTO users(id,display_name,client_organization_id) VALUES($1,'Synthetic staff',NULL),($2,'Synthetic member',$4),($3,'Synthetic outsider',$5)", [staff, member, outsider, orgA, orgB]);
  const app = express();
  app.use(express.json(), cookieParser(), attachUserIfPresent);
  // Test-only identity injection, never mounted in the application.
  app.use((req, _res, next) => {
    const actor = req.get("x-test-person");
    if (([staff, member, outsider] as string[]).includes(actor ?? "")) req.authedUser = {
      id: actor!, authProvider: "local", externalSubject: null, email: null, displayName: "Synthetic",
      avatarUrl: null, bio: null, roles: [], effectiveCapabilities: actor === staff ? ["client_orgs.manage"] : [],
    };
    next();
  });
  app.use(attachSharedAccess);
  app.use("/api", privatePages, sharedAccounts);
  app.get("/api/cms/users", (_req, res) => res.json({ shouldNotReach: true }));
  app.use((_req, res) => res.sendStatus(404));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, actor?: string, init: RequestInit = {}) => fetch(base + path, {
    ...init, headers: { ...(actor ? { "x-test-person": actor } : {}), Origin: base, "X-Galaxy-Request": "1", ...init.headers },
  });
  const write = (path: string, body: unknown, actor: string = staff, method = "POST") =>
    request(path, actor, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const admin = `/api/admin/private-pages/${orgA}`;
  let pageId = "", accountId = "", accountUserId = "";
  let password = "", cookie1 = "", cookie2 = "";
  const login = async (pass: string) => {
    const r = await write("/api/auth/shared/login", { username: `synthetic-${orgA}@example.invalid`, password: pass }, "");
    return { response: r, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const sharedGet = (path: string, cookie = cookie1) => request(path, undefined, { headers: { Cookie: cookie } });
  try {
    await t.test("staff permission is explicit even with empty admin configuration", async () => {
      const previous = process.env.ADMIN_EMAILS;
      process.env.ADMIN_EMAILS = "";
      try {
        assert.equal((await request(`${admin}/pages`)).status, 401);
        assert.equal((await request(`${admin}/pages`, member)).status, 403);
        const csrf = await fetch(base + `${admin}/pages`, { method: "POST", headers: { "x-test-person": staff, Origin: "https://evil.example", "X-Galaxy-Request": "1", "Content-Type": "application/json" }, body: JSON.stringify({ title: "X", slug: "x" }) });
        assert.equal(csrf.status, 403);
      } finally { if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous; }
    });
    await t.test("draft isolation, asset ownership, review and byte ranges", async () => {
      const created = await write(`${admin}/pages`, { title: "Synthetic confidential content", slug: `test-${orgA}` });
      assert.equal(created.status, 201);
      let page = GetPrivateCustomerPageResponse.parse(await created.json()); pageId = page.id;
      assert.equal((await request(`/api/private-pages/${pageId}`)).status, 401);
      assert.equal((await request(`/api/private-pages/${pageId}`, member)).status, 404);
      assert.equal((await request(`/api/private-pages/${pageId}`, staff)).status, 404);
      assert.equal((await request(`/api/private-pages/${pageId}?previewOrg=${orgB}`, staff)).status, 404);
      assert.equal((await request(`/api/private-pages/${pageId}?previewOrg=${orgA}`, member)).status, 404);
      const upload = async (kind: string, bytes: Buffer, filename: string, org = orgA) => request(
        `/api/admin/private-pages/${org}/pages/${pageId}/assets/${kind}`, staff,
        { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Filename": filename, "X-Page-Revision": String(page.revision) }, body: new Uint8Array(bytes) });
      assert.equal((await upload("html", Buffer.from("<p>test</p>"), "test.html", orgB)).status, 404);
      let up = await upload("html", Buffer.from('<p>Original synthetic body</p><audio controls src="guide.mp3"></audio>'), "test.html");
      assert.equal(up.status, 200); page = GetPrivateCustomerPageResponse.parse(await up.json());
      assert.equal((await write(`${admin}/pages/${pageId}`, { action: "review", revision: page.revision }, staff, "PATCH")).status, 409);
      up = await upload("audio", Buffer.from("ID3abcdefghijk"), "guide.mp3");
      assert.equal(up.status, 200); page = GetPrivateCustomerPageResponse.parse(await up.json());
      assert.equal((await write(`${admin}/pages/${pageId}`, { action: "publish", revision: page.revision }, staff, "PATCH")).status, 409);
      assert.equal((await write(`${admin}/pages/${pageId}`, { action: "review", revision: page.revision }, staff, "PATCH")).status, 200);
      assert.equal((await write(`${admin}/pages/${pageId}`, { action: "publish", revision: page.revision }, staff, "PATCH")).status, 200);
      const html = await request(`/api/private-pages/${pageId}/html`, member);
      assert.equal(html.status, 200);
      assert.match(html.headers.get("content-security-policy")!, /sandbox allow-scripts/);
      assert.match(html.headers.get("cache-control")!, /no-store/);
      assert.equal(html.headers.get("access-control-allow-origin"), null);
      assert.equal((await request(`/api/private-pages/${pageId}/html`, outsider)).status, 404);
      for (const suffix of ["", "/html", "/script", "/assets/audio", "/assets/transcript"]) {
        assert.equal((await request(`/api/private-pages/${pageId}${suffix}`, outsider)).status, 404);
      }
      const partial = await request(`/api/private-pages/${pageId}/assets/audio`, member, { headers: { Range: "bytes=3-6" } });
      assert.equal(partial.status, 206); assert.equal(partial.headers.get("content-range"), "bytes 3-6/14");
      assert.equal(await partial.text(), "abcd");
      const bad = await request(`/api/private-pages/${pageId}/assets/audio`, member, { headers: { Range: "bytes=99-" } });
      assert.equal(bad.status, 416); assert.equal(bad.headers.get("content-range"), "bytes */14");
    });
    await t.test("shared sign-in needs no email and supports simultaneous recipients", async () => {
      const created = await write(`${admin}/accounts`, { username: `synthetic-${orgA}@example.invalid` });
      assert.equal(created.status, 201);
      const data = await created.json() as { password: string; account: { id: string } }; password = data.password; accountId = data.account.id;
      assert.ok(password.length >= 32);
      const row = await pool.query("SELECT user_id,password_hash FROM shared_organization_accounts WHERE id=$1", [accountId]);
      accountUserId = row.rows[0].user_id;
      assert.notEqual(row.rows[0].password_hash, password);
      assert.equal(await loadUserById(accountUserId), null);
      const first = await login(password), second = await login(password);
      assert.equal(first.response.status, 200); assert.equal(second.response.status, 200);
      cookie1 = first.cookie; cookie2 = second.cookie;
      assert.notEqual(cookie1, cookie2);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`)).status, 200);
      assert.equal((await sharedGet("/api/auth/shared/session", cookie2)).status, 200);
      assert.equal((await sharedGet("/api/cms/users")).status, 403);
      assert.equal((await sharedGet("/oauth/authorize")).status, 403);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}?previewOrg=${orgA}`)).status, 404);
      assert.equal((await request("/api/auth/reset-password", undefined, { method: "POST", headers: { Cookie: cookie1, "Content-Type": "application/json" }, body: "{}" })).status, 403);
      const jwt = await signAccessToken({ subject: accountUserId, clientId: "galaxy-portal-spa", scopes: ["openid"], capabilities: [] });
      assert.equal((await request(`/api/private-pages/${pageId}`, undefined, { headers: { Authorization: `Bearer ${jwt}` } })).status, 401);
    });
    await t.test("logout revokes only this session; rotation revokes every old session", async () => {
      const out = await request("/api/auth/shared/logout", undefined, { method: "POST", headers: { Cookie: cookie1 } });
      assert.equal(out.status, 200);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`, cookie1)).status, 401);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`, cookie2)).status, 200);
      const rotated = await write(`${admin}/accounts/${accountId}/rotate`, {});
      assert.equal(rotated.status, 200);
      const next = await rotated.json() as { password: string };
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`, cookie2)).status, 401);
      assert.equal((await login(password)).response.status, 401);
      password = next.password;
      const fresh = await login(password); assert.equal(fresh.response.status, 200); cookie1 = fresh.cookie;
    });
    await t.test("inactive organizations, revoked roster membership, archive and disable fail closed", async () => {
      await pool.query("UPDATE client_organizations SET is_active=false WHERE id=$1", [orgA]);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`)).status, 401);
      assert.equal((await login(password)).response.status, 401);
      await pool.query("UPDATE client_organizations SET is_active=true WHERE id=$1", [orgA]);
      await pool.query("DELETE FROM client_organization_users WHERE user_id=$1", [accountUserId]);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`)).status, 401);
      await pool.query("INSERT INTO client_organization_users(user_id,client_organization_id) VALUES($1,$2)", [accountUserId, orgA]);
      const r = await request(`/api/private-pages/${pageId}`, member); const page = GetPrivateCustomerPageResponse.parse(await r.json());
      assert.equal((await write(`${admin}/pages/${pageId}`, { action: "archive", revision: page.revision }, staff, "PATCH")).status, 200);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`)).status, 404);
      assert.equal((await request(`/api/private-pages/${pageId}?previewOrg=${orgA}`, staff)).status, 200);
      assert.equal((await write(`${admin}/accounts/${accountId}/disable`, {})).status, 200);
      assert.equal((await sharedGet(`/api/private-pages/${pageId}`)).status, 401);
      assert.equal((await login(password)).response.status, 401);
      await assert.rejects(pool.query("UPDATE users SET email='synthetic@example.invalid' WHERE id=$1", [accountUserId]), /cannot be linked/);
      const role = await pool.query("SELECT id FROM roles LIMIT 1");
      if (role.rowCount) await assert.rejects(pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)", [accountUserId, role.rows[0].id]), /cannot receive roles/);
    });
    await t.test("wrong-password attempts are throttled per account", async () => {
      let status = 0;
      for (let i = 0; i < 12; i++) status = (await login("incorrect")).response.status;
      assert.equal(status, 429);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    speFileStorage.storeFile = originalStore; speFileStorage.getFile = originalGet;
    await pool.query("DELETE FROM private_customer_assets WHERE page_id IN (SELECT id FROM private_customer_pages WHERE organization_id IN ($1,$2))", [orgA, orgB]);
    await pool.query("DELETE FROM private_customer_pages WHERE organization_id IN ($1,$2)", [orgA, orgB]);
    await pool.query("DELETE FROM shared_organization_accounts WHERE organization_id IN ($1,$2)", [orgA, orgB]);
    await pool.query("DELETE FROM users WHERE id=$1 OR client_organization_id IN ($2,$3)", [staff, orgA, orgB]);
    await pool.query("DELETE FROM client_organizations WHERE id IN ($1,$2)", [orgA, orgB]);
    await pool.end();
  }
});
