import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable, rolesTable, userRoles, sessionsTable, type RoleName } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession } from "../lib/sessions";
import { initializeChapterAudio } from "../lib/chapterAudio/repository";
import { ListChapterAudioResponse, ExtractChapterAudioResponse } from "@workspace/api-zod";

const tag = randomUUID();
const userIds: string[] = [];
const jobId = randomUUID();
let server: ReturnType<typeof app.listen>;
let base: string;
const cookies: Record<string, string> = {};

test.before(async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Tests must never run against production");
  await initializeChapterAudio();
  for (const role of ["editor", "content_author", "author", "contributor", "registered"] as RoleName[]) {
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
  if (userIds.length) {
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
  ];
  for (const [path, method] of requests) {
    assert.equal((await fetch(`${base}${path}`, { method })).status, 401);
    for (const role of ["author", "contributor", "registered"]) {
      assert.equal((await fetch(`${base}${path}`, { method, headers: { cookie: cookies[role]! } })).status, 403, `${role} ${method} ${path}`);
    }
  }
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

test("production refuses the complete feature before touching chapter data", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await fetch(base, { headers: { cookie: cookies.editor! } })).status, 404);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
