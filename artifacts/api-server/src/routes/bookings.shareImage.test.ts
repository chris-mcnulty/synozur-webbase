import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import * as database from "@workspace/db";

// The actual handlers and SQL run on a single disposable transaction. Never
// import the app (startup jobs/mail), authenticate a real user, or load Graph.
assert.notEqual(process.env.NODE_ENV, "production", "Development fixtures only");
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
await mock.module("../middlewares/requireAdmin.ts", {
  namedExports: { requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() },
});
const forbidden = mock.fn(() => { throw new Error("External booking/auth/mail call forbidden"); });
await mock.module("../lib/graphBookings.ts", {
  namedExports: Object.fromEntries([
    "isGraphBookingsConfigured", "listBusinesses", "getBusiness", "listServices",
    "getStaffAvailability", "createAppointment", "getBookingsGraphStatus",
    "storeBookingsRefreshToken", "clearBookingsRefreshToken",
  ].map((name) => [name, forbidden])),
});
await mock.module("../lib/entraOidc.ts", {
  namedExports: Object.fromEntries([
    "buildAuthorizeUrl", "fetchDiscovery", "generatePkcePair",
    "generateRandomToken", "isEntraConfigured",
  ].map((name) => [name, forbidden])),
});
await mock.module("../lib/authStateStore.ts", {
  namedExports: { persistAuthPendingState: forbidden, consumeAuthPendingState: forbidden },
});
await mock.module("../lib/turnstile.ts", { namedExports: { verifyTurnstile: forbidden } });

const { default: bookingsRouter } = await import("./bookings");
const { resolveOgData } = await import("../lib/ogResolver");
const rollback = new Error("Rollback disposable booking fixtures");

test("booking share-image HTTP save/read contract and configured OG defaults", async (t) => {
  try {
    await database.db.transaction(async (tx) => {
      fixtureDb = tx as unknown as typeof database.db;
      const tag = randomUUID();
      const defaultPath = `/api/storage/objects/uploads/default-${tag}.png`;
      const [media] = await tx.insert(database.mediaTable).values({
        storageKey: `/objects/uploads/default-${tag}.png`,
        publicUrl: defaultPath,
        altText: "Disposable booking default image",
        mime: "image/png",
      }).returning();
      // Transaction-local replacement: no live defaults are committed or
      // visible to another connection, even when an assertion fails.
      await tx.delete(database.siteSettingsTable);
      await tx.insert(database.siteSettingsTable).values({
        id: 1,
        seoDefaultDescription: "Configured booking fallback description",
        seoDefaultOgImageMediaId: media!.id,
      });

      const app = express();
      app.use(express.json());
      app.use("/api", bookingsRouter);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      // Isolated ephemeral test server, not a running artifact service.
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      const request = async (path: string, method = "GET", body?: unknown) => {
        const res = await fetch(`${base}${path}`, {
          method, headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal(res.status, method === "POST" ? 201 : 200, await res.clone().text());
        return await res.json() as Record<string, unknown>;
      };
      const calendar = {
        embedUrl: "https://bookings.cloud.microsoft/owa/calendar/fixture/bookings/",
        msBusinessId: "fixture@tenant.onmicrosoft.com",
        msDefaultServiceId: "fixture-service",
        msTimezone: "America/Vancouver",
        scope: "conference",
        startsAt: "2020-01-01T00:00:00.000Z",
        endsAt: "2099-01-01T00:00:00.000Z",
        displayOrder: 17, active: true,
      };
      const unchanged = (row: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(calendar)) assert.equal(row[key], value, key);
      };
      try {
        const originalUrl = `/api/storage/objects/uploads/selected-${tag}.png?source=library`;
        const created = await request("/admin/bookings", "POST", {
          ...calendar, slug: `share-image-${tag}`, title: "Disposable Booking",
          seoDescription: null, teaser: null, ogImageUrl: ` ${originalUrl} `,
        });
        const path = `/admin/bookings/${created.id}`;
        await t.test("create stores original resolved URL, not JPEG preview or media ID", async () => {
          assert.equal(created.ogImageUrl, originalUrl);
          assert.equal(Object.hasOwn(created, "ogImageId"), false);
          unchanged(created);
          assert.equal((await request(path)).ogImageUrl, originalUrl);
          assert.equal((await request(`/bookings/${created.slug}`)).ogImageUrl, originalUrl);
        });
        await t.test("image-only PATCH round trips and leaves all calendar fields unchanged", async () => {
          const url = `/api/storage/objects/uploads/replacement-${tag}.webp`;
          const saved = await request(path, "PATCH", { ogImageUrl: url });
          assert.equal(saved.ogImageUrl, url);
          unchanged(saved);
          const read = await request(path);
          assert.equal(read.ogImageUrl, url);
          unchanged(read);
          const og = await resolveOgData(`/start/${created.slug}`);
          const preview = new URL(og.image);
          assert.equal(preview.pathname, url);
          assert.equal(preview.searchParams.get("w"), "1200");
          assert.equal(preview.searchParams.get("fmt"), "jpeg");
        });
        await t.test("omission preserves metadata; explicit null clears and resolves configured defaults", async () => {
          const before = await request(path);
          await request(path, "PATCH", { seoTitle: "Booking share title" });
          assert.equal((await request(path)).ogImageUrl, before.ogImageUrl);
          const cleared = await request(path, "PATCH", { ogImageUrl: null });
          assert.equal(cleared.ogImageUrl, null);
          unchanged(cleared);
          const read = await request(path);
          assert.equal(read.ogImageUrl, null);
          unchanged(read);
          const publicRead = await request(`/bookings/${created.slug}`);
          assert.equal(publicRead.ogImageUrl, null);
          const og = await resolveOgData(`/start/${created.slug}`);
          assert.equal(og.description, "Configured booking fallback description");
          const preview = new URL(og.image);
          assert.equal(preview.pathname, defaultPath);
          assert.equal(preview.searchParams.get("w"), "1200");
          assert.equal(preview.searchParams.get("fmt"), "jpeg");
        });
        await t.test("legacy URL-only rows remain readable and survive unrelated saves", async () => {
          const legacyUrl = "https://images.example.test/legacy-share.jpg";
          const [legacy] = await tx.insert(database.bookingsTable).values({
            ...calendar, startsAt: new Date(calendar.startsAt), endsAt: new Date(calendar.endsAt),
            slug: `legacy-${tag}`, title: "Legacy URL-only booking", ogImageUrl: legacyUrl,
          }).returning();
          const legacyPath = `/admin/bookings/${legacy!.id}`;
          assert.equal((await request(legacyPath)).ogImageUrl, legacyUrl);
          await request(legacyPath, "PATCH", { seoDescription: "Legacy description override" });
          const read = await request(legacyPath);
          assert.equal(read.ogImageUrl, legacyUrl);
          unchanged(read);
          const og = await resolveOgData(`/start/${legacy!.slug}`);
          assert.equal(og.image, legacyUrl);
          assert.equal(og.description, "Legacy description override");
        });
        assert.equal(forbidden.mock.callCount(), 0, "No external services may be invoked");
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    fixtureDb = database.db;
    await database.pool.end();
  }
});
