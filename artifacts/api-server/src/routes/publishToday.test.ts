/**
 * Integration tests for #467 — content dated "today" (date-only admin
 * pickers store midnight UTC) must be publicly visible immediately, not
 * hidden until midnight UTC passes. Extends the #466 white-paper fix to
 * posts, videos, collateral, Polaris episodes, models, case studies, and
 * applications.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:publish-today
 *
 * Like the other tests in this workspace, this hits the real DATABASE_URL
 * because the logic under test IS the SQL. Each test provisions throwaway
 * rows scoped by a per-run tag and tears them down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  pool,
  eventsTable,
  postsTable,
  usersTable,
  videosTable,
  collateralTable,
  polarisEpisodesTable,
  modelsTable,
  caseStudiesTable,
  applicationsTable,
} from "@workspace/db";
import app from "../app";
import { startOfNextUtcDay } from "../lib/publishWindow";

const tag = crypto.randomUUID().slice(0, 8);

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
const today = startOfTodayUtc();
const tomorrow = startOfNextUtcDay(new Date());

let server: http.Server;
let baseUrl: string;
let authorId: string;

const cleanup: Array<() => Promise<unknown>> = [];

test.before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [author] = await db
    .insert(usersTable)
    .values({ email: `pubtoday-${tag}@example.test`, displayName: `PubToday ${tag}` })
    .returning();
  authorId = author.id;
  cleanup.push(() => db.delete(usersTable).where(eq(usersTable.id, authorId)));
});

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function fetchJson(path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`);
  assert.equal(res.status, 200, `GET ${path} should be 200`);
  return res.json();
}

function slugs(payload: any): string[] {
  const items = Array.isArray(payload) ? payload : payload.items;
  return (items ?? []).map((i: any) => i.slug);
}

test("post published today is on the public insights list; tomorrow's is not", async () => {
  const todaySlug = `post-today-${tag}`;
  const tomorrowSlug = `post-tomorrow-${tag}`;
  const rows = await db
    .insert(postsTable)
    .values([
      { slug: todaySlug, title: "Today post", authorId, status: "published", publishedAt: today },
      { slug: tomorrowSlug, title: "Tomorrow post", authorId, status: "published", publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(postsTable).where(inArray(postsTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/insights?pageSize=50`);
  assert.ok(slugs(list).includes(todaySlug), "post dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "post dated tomorrow must stay hidden");

  const detail = await fetch(`${baseUrl}/api/insights/${todaySlug}`);
  assert.equal(detail.status, 200, "today's post detail should not 404");
  const futureDetail = await fetch(`${baseUrl}/api/insights/${tomorrowSlug}`);
  assert.equal(futureDetail.status, 404, "tomorrow's post detail must 404");
});

test("video published today is visible on list and detail; tomorrow's is not", async () => {
  const todaySlug = `video-today-${tag}`;
  const tomorrowSlug = `video-tomorrow-${tag}`;
  const rows = await db
    .insert(videosTable)
    .values([
      { slug: todaySlug, title: `Video today ${tag}`, status: "published", active: true, publishedAt: today },
      { slug: tomorrowSlug, title: `Video tomorrow ${tag}`, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(videosTable).where(inArray(videosTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/videos?pageSize=50&q=${tag}`);
  assert.ok(slugs(list).includes(todaySlug), "video dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "video dated tomorrow must stay hidden");

  const detail = await fetch(`${baseUrl}/api/videos/${todaySlug}`);
  assert.equal(detail.status, 200);
  const futureDetail = await fetch(`${baseUrl}/api/videos/${tomorrowSlug}`);
  assert.equal(futureDetail.status, 404);
});

test("event exposes a recording video dated today; hides one dated tomorrow", async () => {
  const todayVideoSlug = `event-video-today-${tag}`;
  const tomorrowVideoSlug = `event-video-tomorrow-${tag}`;
  const videoRows = await db
    .insert(videosTable)
    .values([
      { slug: todayVideoSlug, title: `Event video today ${tag}`, status: "published", active: true, publishedAt: today },
      { slug: tomorrowVideoSlug, title: `Event video tomorrow ${tag}`, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(videosTable).where(inArray(videosTable.id, videoRows.map((r) => r.id))),
  );

  const todayEventSlug = `event-today-${tag}`;
  const tomorrowEventSlug = `event-tomorrow-${tag}`;
  const eventRows = await db
    .insert(eventsTable)
    .values([
      { title: `Event today ${tag}`, slug: todayEventSlug, startDate: today, recordingVideoId: videoRows[0].id },
      { title: `Event tomorrow ${tag}`, slug: tomorrowEventSlug, startDate: today, recordingVideoId: videoRows[1].id },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(eventsTable).where(inArray(eventsTable.id, eventRows.map((r) => r.id))),
  );

  const withTodayVideo = await fetchJson(`/api/events/${todayEventSlug}`);
  assert.equal(
    withTodayVideo.recordingVideoSlug,
    todayVideoSlug,
    "recording video dated today should be attached to the event now",
  );

  const withTomorrowVideo = await fetchJson(`/api/events/${tomorrowEventSlug}`);
  assert.equal(
    withTomorrowVideo.recordingVideoSlug,
    null,
    "recording video dated tomorrow must stay hidden from the event",
  );
});

test("collateral published today is visible; tomorrow's is not", async () => {
  const todaySlug = `collateral-today-${tag}`;
  const tomorrowSlug = `collateral-tomorrow-${tag}`;
  const rows = await db
    .insert(collateralTable)
    .values([
      { slug: todaySlug, type: "ebook", title: `Collateral today ${tag}`, description: "d", url: `/x/${todaySlug}`, active: true, publishedAt: today },
      { slug: tomorrowSlug, type: "ebook", title: `Collateral tomorrow ${tag}`, description: "d", url: `/x/${tomorrowSlug}`, active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(collateralTable).where(inArray(collateralTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/collateral?pageSize=50&q=${tag}`);
  assert.ok(slugs(list).includes(todaySlug), "collateral dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "collateral dated tomorrow must stay hidden");
});

test("polaris episode published today is visible; tomorrow's is not", async () => {
  const todaySlug = `polaris-today-${tag}`;
  const tomorrowSlug = `polaris-tomorrow-${tag}`;
  const rows = await db
    .insert(polarisEpisodesTable)
    .values([
      { slug: todaySlug, title: `Polaris today ${tag}`, episodeNumber: 99901, status: "published", active: true, publishedAt: today },
      { slug: tomorrowSlug, title: `Polaris tomorrow ${tag}`, episodeNumber: 99902, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(polarisEpisodesTable).where(inArray(polarisEpisodesTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/polaris/episodes?pageSize=100`);
  assert.ok(slugs(list).includes(todaySlug), "episode dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "episode dated tomorrow must stay hidden");
});

test("model published today is visible; tomorrow's is not", async () => {
  const todaySlug = `model-today-${tag}`;
  const tomorrowSlug = `model-tomorrow-${tag}`;
  const rows = await db
    .insert(modelsTable)
    .values([
      { slug: todaySlug, title: `Model today ${tag}`, status: "published", active: true, publishedAt: today },
      { slug: tomorrowSlug, title: `Model tomorrow ${tag}`, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(modelsTable).where(inArray(modelsTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/models`);
  assert.ok(slugs(list).includes(todaySlug), "model dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "model dated tomorrow must stay hidden");
});

test("case study published today is visible; tomorrow's is not", async () => {
  const todaySlug = `case-today-${tag}`;
  const tomorrowSlug = `case-tomorrow-${tag}`;
  const rows = await db
    .insert(caseStudiesTable)
    .values([
      { slug: todaySlug, title: `Case today ${tag}`, status: "published", active: true, publishedAt: today },
      { slug: tomorrowSlug, title: `Case tomorrow ${tag}`, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(caseStudiesTable).where(inArray(caseStudiesTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/case-studies`);
  assert.ok(slugs(list).includes(todaySlug), "case study dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "case study dated tomorrow must stay hidden");
});

test("application published today is visible; tomorrow's is not", async () => {
  const todaySlug = `app-today-${tag}`;
  const tomorrowSlug = `app-tomorrow-${tag}`;
  const rows = await db
    .insert(applicationsTable)
    .values([
      { slug: todaySlug, title: `App today ${tag}`, status: "published", active: true, publishedAt: today },
      { slug: tomorrowSlug, title: `App tomorrow ${tag}`, status: "published", active: true, publishedAt: tomorrow },
    ])
    .returning();
  cleanup.push(() =>
    db.delete(applicationsTable).where(inArray(applicationsTable.id, rows.map((r) => r.id))),
  );

  const list = await fetchJson(`/api/applications`);
  assert.ok(slugs(list).includes(todaySlug), "application dated today should be listed now");
  assert.ok(!slugs(list).includes(tomorrowSlug), "application dated tomorrow must stay hidden");
});
