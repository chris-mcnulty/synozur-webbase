import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import { get as httpGet } from "node:http";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import express from "express";
import { eq, sql } from "drizzle-orm";
import * as database from "@workspace/db";

assert.notEqual(process.env.NODE_ENV, "production", "Disposable development fixtures only");
let fixtureDb = database.db;
await mock.module("@workspace/db", {
  namedExports: {
    ...database,
    db: new Proxy(database.db, {
      get(_target, key) {
        const value = Reflect.get(fixtureDb, key);
        return typeof value === "function" ? value.bind(fixtureDb) : value;
      },
    }),
  },
});
const { default: router } = await import("./board");
const { boardPageGuard, isBoardAdmin, boardIsPublic } = await import("../lib/board");
const { migrateBoard } = await import("../lib/boardMigration");
const { resolveOgData } = await import("../lib/ogResolver");
const { buildAgentPageHtml } = await import("../lib/agentRenderer");
const { resolveRouteStatus } = await import("../lib/routeStatus");
const { default: seoRouter, collectEntries, handleLlmsTxt, handleSitemap } = await import("./seo");
const { default: teamRouter } = await import("./teamMembers");
const { default: auditRouter } = await import("./cms/auditLog");
const { socialBotRendererMiddleware } = await import("../middlewares/socialBotRenderer");
const { agentBotRendererMiddleware } = await import("../middlewares/agentBotRenderer");
const rollback = new Error("Rollback Board fixtures");

test("production service worker never intercepts or caches Board requests", () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const origin = "https://board-fixture.invalid";
  runInNewContext(readFileSync(new URL("../../../synozur/public/sw.js", import.meta.url), "utf8"), {
    URL, Request,
    self: { location: { origin }, addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; } },
  });
  for (const path of ["/board", "/board/chris-mcnulty", "/api/board", "/api/board/chris-mcnulty"]) {
    let intercepted = false;
    listeners.fetch!({ request: new Request(`${origin}${path}`), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test("Board strict roles, CRUD, grouping, live Team links and private/public discovery", async () => {
  const originalAllowlist = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "";
  try {
    await database.db.transaction(async tx => {
      fixtureDb = tx as unknown as typeof database.db;
      // All publication and fixture writes remain inside this transaction.
      await tx.delete(database.boardProfilesTable);
      await tx.delete(database.boardSettingsTable);
      await migrateBoard();
      assert.equal(await boardIsPublic(), false);
      const seeded = await tx.select().from(database.boardProfilesTable);
      assert.equal(seeded.filter(p => p.group === "external").length, 0);
      assert.equal(seeded.length, 2, "Verified Michelle and Chris linked once");
      await migrateBoard();
      assert.equal((await tx.select().from(database.boardProfilesTable)).length, 2);
      const [actor] = await tx.insert(database.usersTable).values({ displayName: "Disposable Board test" }).returning();
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const role = req.get("x-test-role");
        if (role) req.authedUser = {
          id: actor!.id, email: null, displayName: "Fixture", avatarUrl: null,
          externalSubject: null, authProvider: role === "api_key" ? "api_key" : "local",
          bio: null, roles: [role as "admin"], effectiveCapabilities: ["site.manage"],
        };
        next();
      });
      app.use(boardPageGuard);
      app.use(socialBotRendererMiddleware());
      app.use(agentBotRendererMiddleware());
      app.use("/api", router);
      app.use("/api", seoRouter);
      app.use("/api", teamRouter);
      app.use("/api", auditRouter);
      app.get("/sitemap.xml", handleSitemap);
      app.get("/llms.txt", handleLlmsTxt);
      app.get("/board{/:slug}", (_req, res) => {
        // Simulate the existing SPA/bot chain trying to cache the response.
        res.set("Cache-Control", "public, max-age=300").send("Board shell");
      });
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      // An isolated test HTTP server, not a running artifact service.
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const request = (path: string, role?: string, method = "GET", body?: unknown) =>
        fetch(`${base}${path}`, { method, headers: {
          "Content-Type": "application/json", ...(role ? { "x-test-role": role } : {}),
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      try {
        for (const role of [undefined, "registered", "editor", "api_key"]) {
          for (const path of ["/api/board", "/api/board/chris-mcnulty", "/board", "/board/chris-mcnulty"]) {
            const res = await request(path, role);
            assert.equal(res.status, 404, `${role} ${path}`);
            assert.match(res.headers.get("cache-control")!, /no-store/);
            assert.doesNotMatch(await res.text(), /Chris|Michelle/);
          }
          assert.equal((await request("/api/admin/board", role)).status, role ? 403 : 401);
          for (const [path, method, body] of [
            ["/api/admin/board", "POST", {}],
            ["/api/admin/board/visibility", "PUT", { public: true }],
            ["/api/admin/board/1", "PUT", {}],
            ["/api/admin/board/1", "DELETE", undefined],
          ] as const) assert.equal((await request(path, role, method, body)).status, role ? 403 : 401);
        }
        assert.equal(isBoardAdmin({ roles: ["editor"], effectiveCapabilities: ["site.manage"] } as never), false);
        for (const role of ["admin", "site_admin"]) {
          const roster = await request("/api/board", role);
          assert.equal(roster.status, 200);
          assert.match(roster.headers.get("cache-control")!, /private.*no-store/);
          assert.match(roster.headers.get("x-robots-tag")!, /noindex/);
          const html = await request("/board", role);
          assert.equal(html.status, 200);
          assert.match(html.headers.get("cache-control")!, /private.*no-store/);
          assert.equal((await request("/api/admin/board/team-options", role)).status, 200);
        }
        for (const path of ["/api/og?path=/board/chris-mcnulty", "/api/seo/page?path=/board", "/api/seo/route-status?path=/board"]) {
          const res = await request(path);
          assert.equal(res.status, 404);
          assert.match(res.headers.get("cache-control")!, /no-store/);
        }
        assert.equal((await collectEntries()).some(e => /\/board(?:\/|$)/.test(e.loc)), false);
        assert.doesNotMatch(await (await request("/llms.txt")).text(), /\/board/);
        const teamBefore = await (await request("/api/team-members")).json();
        assert.doesNotMatch(JSON.stringify(teamBefore), /board|teamMemberId|member_group/);
        assert.equal(await resolveRouteStatus("/board"), "not_found");
        assert.doesNotMatch(await buildAgentPageHtml("/board"), /href="[^"]*\/board\/chris/);
        assert.equal((await resolveOgData("/board/chris-mcnulty")).title, "Not found");

        const tag = randomUUID().slice(0, 8);
        const external = { group: "external", name: `Disposable advisor ${tag}`, slug: `board-test-${tag}`,
          jobTitle: "Test advisor", active: true, sortOrder: 999, shortDescription: "<p>Test summary</p>",
          longDescription: "<p>Test biography</p>", website: "https://example.com", linkedinUrl: null };
        const create = await request("/api/admin/board", "admin", "POST", external);
        assert.equal(create.status, 201, await create.clone().text());
        const advisor = await create.json() as { id: number };
        const biography = await (await request(`/api/board/${external.slug}`, "admin")).json() as { longDescription: string };
        assert.equal(biography.longDescription, external.longDescription, "Rich editor HTML must not be escaped as legacy plain text");
        const editorRoster = await (await request("/api/admin/board", "admin")).json() as { items: { id: number; longDescription: string }[] };
        assert.equal(editorRoster.items.find(p => p.id === advisor.id)!.longDescription, external.longDescription, "Reopening must preserve rich HTML without double escaping");
        const auditPath = `/api/cms/audit-log?entity=board_profile&entityId=${advisor.id}`;
        const editorAudit = await request(auditPath, "editor");
        assert.equal(editorAudit.status, 200);
        assert.deepEqual((await editorAudit.json() as { items: unknown[] }).items, []);
        const adminAudit = await request(auditPath, "admin");
        assert.match(await adminAudit.text(), /Disposable advisor/);
        const machineExport = await request("/api/cms/audit-log.csv?entity=board_profile", "api_key");
        assert.equal(machineExport.status, 200);
        assert.doesNotMatch(await machineExport.text(), /Disposable advisor|Test biography/);
        const roster = await (await request("/api/board", "site_admin")).json() as { items: { id: number }[] };
        assert.equal(roster.items[0].id, advisor.id, "External first even with larger ordering key");
        const [chris] = await tx.select().from(database.teamMembersTable).where(eq(database.teamMembersTable.slug, "chris-mcnulty"));
        await tx.update(database.teamMembersTable).set({ longDescription: "<p>Live linked bio fixture</p>" }).where(eq(database.teamMembersTable.id, chris!.id));
        const linked = await (await request("/api/board/chris-mcnulty", "admin")).json() as { longDescription: string };
        assert.match(linked.longDescription, /Live linked bio fixture/);
        const rawLinked = (await tx.select().from(database.boardProfilesTable)).find(p => p.teamMemberId === chris!.id);
        assert.equal(rawLinked!.longDescription, null);
        assert.equal(rawLinked!.name, null);

        assert.equal((await request(`/api/admin/board/${advisor.id}`, "site_admin", "PUT", { ...external, active: false })).status, 200);
        assert.equal((await request(`/api/board/${external.slug}`, "admin")).status, 404);
        await request(`/api/admin/board/${advisor.id}`, "admin", "PUT", external);
        assert.equal((await request("/api/admin/board/visibility", "site_admin", "PUT", { public: true })).status, 200);
        await migrateBoard();
        assert.equal(await boardIsPublic(), true, "Migration never resets explicit release");
        assert.equal((await request(`/api/board/${external.slug}`)).status, 200);
        assert.equal((await request("/board")).status, 200);
        assert.equal(await resolveRouteStatus(`/board/${external.slug}`), "ok");
        assert.match((await resolveOgData(`/board/${external.slug}`)).title, /Disposable advisor/);
        assert.match(await buildAgentPageHtml(`/board/${external.slug}`), /Test biography/);
        assert.match(await buildAgentPageHtml("/board"), new RegExp(external.slug));
        assert.ok((await collectEntries()).some(e => e.loc.endsWith(`/board/${external.slug}`)));
        for (const path of ["/api/og?path=/board", "/api/seo/page?path=/board", "/api/seo/route-status?path=/board"]) {
          const res = await request(path);
          assert.equal(res.status, 200, path);
          assert.match(res.headers.get("cache-control")!, /no-store/);
        }
        for (const ua of ["GPTBot", "Googlebot", "LinkedInBot", "curl/8"]) {
          // Node fetch injects Sec-Fetch-Mode: cors even for a synthetic UA.
          // Use real raw HTTP to exercise curl/non-JS routing accurately.
          const res = await new Promise<{ status?: number; body: string; cache: string }>((resolve, reject) => {
            httpGet(`${base}/board/${external.slug}`, { headers: { "User-Agent": ua } }, response => {
              let body = "";
              response.on("data", chunk => { body += String(chunk); });
              response.on("end", () => resolve({ status: response.statusCode, body, cache: String(response.headers["cache-control"]) }));
            }).on("error", reject);
          });
          assert.equal(res.status, 200);
          assert.match(res.body, /Disposable advisor/, ua);
          assert.match(res.cache, /no-store/);
        }
        assert.match(await (await request("/llms.txt")).text(), /\/board/);

        await request("/api/admin/board/visibility", "admin", "PUT", { public: false });
        assert.equal((await request("/board")).status, 404);
        assert.equal((await request(`/api/board/${external.slug}`, "registered")).status, 404);
        assert.equal(await resolveRouteStatus(`/board/${external.slug}`), "not_found");
        assert.doesNotMatch(await buildAgentPageHtml(`/board/${external.slug}`), /Test biography/);
        assert.deepEqual(await (await request("/api/team-members")).json(), teamBefore, "Team list is unchanged by Board publication/mutations");
        assert.equal((await request(`/api/admin/board/${advisor.id}`, "site_admin", "DELETE")).status, 204);
        await request(`/api/admin/board/${rawLinked!.id}`, "admin", "DELETE");
        await migrateBoard();
        assert.equal((await tx.select().from(database.boardProfilesTable)).some(p => p.teamMemberId === chris!.id), false, "Removal survives redeploy");
        assert.equal((await tx.select().from(database.teamMembersTable).where(eq(database.teamMembersTable.id, chris!.id))).length, 1, "Team is not deleted");
        const audits = await tx.execute(sql`SELECT action FROM audit_log WHERE actor_id = ${actor!.id}`);
        for (const action of ["board.create", "board.update", "board.delete", "board.visibility"]) {
          assert.ok(audits.rows.some(row => row.action === action), `Audited ${action}`);
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    if (originalAllowlist === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAllowlist;
    await database.pool.end();
  }
});
