import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable, rolesTable, userRoles, sessionsTable, type RoleName } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession } from "../lib/sessions";
import { initializeChapterAudio } from "../lib/chapterAudio/repository";
import { ListChapterAudioResponse, ExtractChapterAudioResponse, EstimateChapterAudioResponse, GetChapterAudioCostsResponse, SaveChapterAudioPricingResponse } from "@workspace/api-zod";
import { beginSpeechAttempt, finishSpeechAttempt, jobCostMap, recordReusedSection } from "../lib/chapterAudio/costs";
import { renderChapterSection, isAzureTtsConfigured } from "../lib/chapterAudio/speech";

const tag = randomUUID();
const userIds: string[] = [];
const jobId = randomUUID();
let server: ReturnType<typeof app.listen>;
let base: string;
const cookies: Record<string, string> = {};
const rateIds: string[] = [];

test.before(async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Tests must never run against production");
  await initializeChapterAudio();
  for (const role of ["editor", "content_author", "author", "contributor", "registered", "admin"] as RoleName[]) {
    const [user] = await db.insert(usersTable).values({ email: `chapter-${role}-${tag}@example.invalid`, displayName: "Chapter integration test", authProvider: "test" }).returning();
    userIds.push(user.id);
    let existing = await db.query.rolesTable.findFirst({ where: eq(rolesTable.name, role) });
    if (!existing) [existing] = await db.insert(rolesTable).values({ name: role }).returning();
    await db.insert(userRoles).values({ userId: user.id, roleId: existing.id });
    const session = await createSession({ userId: user.id, userAgent: "chapter-audio-integration", ip: "127.0.0.1" });
    cookies[role] = `sid=${encodeURIComponent(session.token)}`;
  }
  await pool.query(`INSERT INTO chapter_audio_jobs(id,title,creator_id,creator_name,voice,status,word_count,total_chunks,expires_at)
    VALUES($1,'Expiry test',$2,'Test','en-US-Ava:DragonHDLatestNeural','completed',5,1,now()-interval '1 minute')`, [jobId, userIds[0]]);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cms/chapter-audio`;
});
test.after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  await pool.query("DELETE FROM chapter_audio_jobs WHERE id=$1", [jobId]);
  if (rateIds.length) await pool.query("DELETE FROM chapter_audio_rates WHERE id=ANY($1::uuid[])", [rateIds]);
  if (userIds.length) {
    await pool.query("DELETE FROM chapter_audio_usage WHERE actor_id=ANY($1::text[])", [userIds]);
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  await pool.end();
});

test("anonymous and Guest/restricted roles cannot reach ANY chapter endpoint", async () => {
  const requests: [string, string][] = [
    ["", "GET"], ["", "POST"], ["/extract?filename=chapter.txt", "POST"],
    ["/sample/en-US-Ava%3ADragonHDLatestNeural", "GET"], [`/${jobId}/audio`, "GET"], [`/${jobId}/delete`, "POST"],
    ["/estimate", "POST"], ["/pricing", "POST"], ["/costs", "GET"],
  ];
  for (const [path, method] of requests) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, 401);
    for (const role of ["author", "contributor", "registered"]) {
      assert.equal((await fetch(`${base}${path}`, { method, headers: { cookie: cookies[role]! } })).status, 403, `${role} ${method} ${path}`);
    }
  }
});

test("editor estimates are free of provider calls, include notes and SSML, and never invent a missing price", async () => {
  const response = await fetch(`${base}/estimate`, {
    method: "POST", headers: { cookie: cookies.editor!, "content-type": "application/json" },
    body: JSON.stringify({ text: "Hello, Synozur.", notes: "Useful note.", appendNotes: true, voice: "en-US-Ava:DragonHDLatestNeural" }),
  });
  assert.equal(response.status, 200);
  const estimate = EstimateChapterAudioResponse.parse(await response.json());
  assert.ok(estimate.sourceCharacters > 14);
  assert.ok(estimate.billableCharacters > estimate.sourceCharacters);
  const history = ListChapterAudioResponse.parse(await (await fetch(base, { headers: { cookie: cookies.editor! } })).json());
  if (!history.pricing.currentRate) assert.equal(estimate.estimatedCost, null);
  assert.equal(history.pricing.canManageRates, false);
  for (const [path, method] of [["/pricing", "POST"], ["/costs", "GET"]]) {
    assert.equal((await fetch(`${base}${path}`, { method, headers: { cookie: cookies.editor! } })).status, 403);
  }
});

test("only administrators can version rates; invalid prices, currencies, dates and report months are rejected", async () => {
  const request = (data: unknown) => fetch(`${base}/pricing`, { method: "POST",
    headers: { cookie: cookies.admin!, "content-type": "application/json" }, body: JSON.stringify(data) });
  for (const bad of [
    { perMillion: -1, currency: "USD", effectiveFrom: "2098-01-01" },
    { perMillion: 10, currency: "ZZZ", effectiveFrom: "2098-01-01" },
    { perMillion: 10, currency: "USD", effectiveFrom: "not a date" },
  ]) assert.equal((await request(bad)).status, 400);
  const saved = await request({ perMillion: 17.5, currency: "USD", effectiveFrom: "2098-01-01T00:00:00Z" });
  assert.equal(saved.status, 200);
  const rate = SaveChapterAudioPricingResponse.parse(await saved.json()); rateIds.push(rate.id);
  assert.equal(rate.perMillion, 17.5);
  assert.equal((await fetch(`${base}/costs?month=2026-13`, { headers: { cookie: cookies.admin! } })).status, 400);
  const summary = await fetch(`${base}/costs?month=${new Date().toISOString().slice(0, 7)}`, { headers: { cookie: cookies.admin! } });
  assert.equal(summary.status, 200);
  assert.equal(GetChapterAudioCostsResponse.parse(await summary.json()).timezone, "UTC");
});

test("usage is durable before requests, retries and reuse are distinct, and deleting a job cannot erase its cost audit", async () => {
  const context = { jobId, sectionIndex: 0, actorId: userIds[0]!, actorLabel: "Usage verification" };
  const first = await beginSpeechAttempt("Hello.", "en-US-Ava:DragonHDLatestNeural", context);
  await finishSpeechAttempt(first, "succeeded");
  await beginSpeechAttempt("Hello.", "en-US-Ava:DragonHDLatestNeural", context); // crashed/unfinished request
  await recordReusedSection("en-US-Ava:DragonHDLatestNeural", context);
  const cost = (await jobCostMap([{ id: jobId, metering_version: 0 }])).get(jobId)!;
  assert.equal(cost.legacyUsageGap, true);
  assert.equal(cost.usage.attempts, 2);
  assert.equal(cost.usage.retryCharacters, 6);
  assert.equal(cost.usage.uncertainCharacters, 6);
  assert.equal(cost.usage.reusedSections, 1);
  const orphan = randomUUID();
  await pool.query("UPDATE chapter_audio_usage SET job_id=$1 WHERE id=$2", [orphan, first]);
  assert.equal((await pool.query("SELECT 1 FROM chapter_audio_usage WHERE job_id=$1", [orphan])).rowCount, 1);
});

test("the actual synthesis wrapper records successful, throttled, uncertain and timed-out attempts without paid calls", { skip: !isAzureTtsConfigured() }, async () => {
  const context = { jobId, sectionIndex: 99, actorId: userIds[0]!, actorLabel: "Mocked provider verification" };
  const originalFetch = globalThis.fetch;
  let status = 200;
  let timeout = false;
  globalThis.fetch = async () => {
    const intent = await pool.query("SELECT outcome FROM chapter_audio_usage WHERE job_id=$1 AND section_index=99 ORDER BY started_at DESC LIMIT 1", [jobId]);
    assert.equal(intent.rows[0].outcome, "started", "paid requests require a prior durable usage intent");
    if (timeout) throw new DOMException("Simulated timeout", "AbortError");
    return new Response(Buffer.alloc(160), { status });
  };
  try {
    await renderChapterSection("Metering test.", "en-US-Ava:DragonHDLatestNeural", context);
    status = 429;
    await assert.rejects(renderChapterSection("Metering test.", "en-US-Ava:DragonHDLatestNeural", context));
    status = 400;
    await assert.rejects(renderChapterSection("Metering test.", "en-US-Ava:DragonHDLatestNeural", context));
    timeout = true;
    await assert.rejects(renderChapterSection("Metering test.", "en-US-Ava:DragonHDLatestNeural", context));
  } finally { globalThis.fetch = originalFetch; }
  const attempts = await pool.query("SELECT outcome,is_retry FROM chapter_audio_usage WHERE job_id=$1 AND section_index=99 ORDER BY started_at", [jobId]);
  assert.deepEqual(attempts.rows.map(row => row.outcome), ["succeeded", "rejected", "uncertain", "uncertain"]);
  assert.deepEqual(attempts.rows.map(row => row.is_retry), [false, true, true, true]);
});

test("both editorial roles can read shared history with private response headers", async () => {
  for (const role of ["editor", "content_author"]) {
    const response = await fetch(base, { headers: { cookie: cookies[role]! } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(response.headers.get("x-robots-tag")?.includes("noindex"));
    const data = ListChapterAudioResponse.parse(await response.json());
    assert.ok(data.jobs.some((job: { id: string; status: string }) => job.id === jobId && job.status === "expired"));
    assert.equal(data.maxWords, 10000);
    assert.equal(data.voices.length, 15);
    assert.ok(data.voices.includes("en-US-Phoebe:DragonHDLatestNeural"));
    assert.ok(data.voices.includes("en-US-Andrew2:DragonHDLatestNeural"));
    assert.ok(!JSON.stringify(data).includes("source.txt"));
  }
});

test("authorized raw upload extraction and input validation do not require speech calls", async () => {
  const response = await fetch(`${base}/extract?filename=chapter.md`, {
    method: "POST", headers: { cookie: cookies.editor!, "content-type": "application/octet-stream" },
    body: "# Chapter\n\nFaithful text.[^1]\n\n[^1]: A useful note.",
  });
  assert.equal(response.status, 200);
  const data = ExtractChapterAudioResponse.parse(await response.json());
  assert.equal(data.text, "Chapter\n\nFaithful text.");
  assert.equal(data.notes, "A useful note.");
  const tooLong = await fetch(base, {
    method: "POST", headers: { cookie: cookies.editor!, "content-type": "application/json" },
    body: JSON.stringify({ title: "Oversized", text: "word ".repeat(10001), voice: "en-US-Ava:DragonHDLatestNeural" }),
  });
  assert.equal(tooLong.status, 400);
});

test("expiry denies both playback and retry even before cleanup", async () => {
  assert.equal((await fetch(`${base}/${jobId}/audio`, { headers: { cookie: cookies.editor! } })).status, 410);
  assert.equal((await fetch(`${base}/${jobId}/retry`, { method: "POST", headers: { cookie: cookies.editor! } })).status, 410);
});

test("production retains editorial access and denies guests and anonymous visitors", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await fetch(base, { headers: { cookie: cookies.editor! } })).status, 200);
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { cookie: cookies.registered! } })).status, 403);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
