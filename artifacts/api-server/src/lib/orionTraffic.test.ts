import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrionTrafficReader, parseOrionTraffic } from "./orionTraffic";

const from = "2026-11-01T00:00:00.000Z";
const to = "2026-11-20T23:59:59.999Z";
function fixture(start = from, end = to) {
  return { data: {
    reportingVersion: 2, totalVisits: 170, from: start, to: end,
    bySection: [{ section: "assessments", count: 116 }, { section: "account", count: 54 }],
    byPage: [{ page: "signup", count: 54 }], byDate: [], byCountry: [], byDevice: [], byBrowser: [],
    activity: {
      totalEvents: 28,
      byEvent: [{ event: "assessment_started", source: "record", count: 10 }],
      byResource: [{ resourceType: "model", resourceId: "test-model", resourceName: "Example model", count: 10, byEvent: { assessment_started: 10 } }],
      timeSeries: [], notes: ["Retained records only."],
    },
    assessmentsStarted: 10,
  } };
}

test("unwraps the actual Orion envelope and strips legacy aliases without adding them", () => {
  const data = parseOrionTraffic(fixture());
  assert.equal(data.totalVisits, 170);
  assert.equal(data.activity.totalEvents, 28);
  assert.equal("assessmentsStarted" in data, false);
  assert.equal("uniqueSessions" in data, false);
});

test("invalid or old reports fail explicitly rather than becoming empty usage", () => {
  assert.throws(() => parseOrionTraffic({ data: { totalVisits: 170 } }));
  assert.throws(() => parseOrionTraffic({ ...fixture(), data: { ...fixture().data, totalVisits: -1 } }));
  assert.throws(() => parseOrionTraffic(fixture().data));
});

test("repeated reads, concurrent refreshes and retries replace snapshots, never add totals", async () => {
  let calls = 0;
  let clock = 1_800_000_000_000;
  const read = createOrionTrafficReader(async () => { calls++; return fixture(); }, () => clock);
  const [first, second] = await Promise.all([read(from, to), read(from, to)]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal((await read(from, to)).data.totalVisits, 170);
  assert.equal(calls, 1);
  const refreshed = await read(from, to, true);
  assert.equal(calls, 2);
  assert.equal(refreshed.data.totalVisits, 170);
  assert.equal(refreshed.data.activity.totalEvents, 28);
  clock += 300_001;
  await read(from, to);
  assert.equal(calls, 3);
});

test("upstream failure retains last success time and marks data stale; recovery clears warning", async () => {
  let fail = false;
  let clock = 1_800_000_000_000;
  const read = createOrionTrafficReader(async () => {
    if (fail) throw new Error("provider unavailable");
    return fixture();
  }, () => clock);
  const original = await read(from, to);
  fail = true;
  clock += 300_001;
  const stale = await read(from, to);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, original.fetchedAt);
  assert.equal(stale.data.totalVisits, 170);
  assert.ok(stale.refreshError);
  fail = false;
  const recovered = await read(from, to);
  assert.equal(recovered.stale, false);
  assert.ok(Date.parse(recovered.fetchedAt) > Date.parse(original.fetchedAt));
});

test("failure without a previous report rejects and synchronous errors do not poison retries", async () => {
  let fail = true;
  const read = createOrionTrafficReader(() => {
    if (fail) throw new Error("offline");
    return Promise.resolve(fixture());
  });
  await assert.rejects(read(from, to));
  fail = false;
  assert.equal((await read(from, to)).data.totalVisits, 170);
});

test("a failed forced refresh stays stale until a genuinely successful upstream read", async () => {
  let fail = false;
  let calls = 0;
  const read = createOrionTrafficReader(async () => {
    calls++;
    if (fail) throw new Error("offline");
    return fixture();
  });
  const original = await read(from, to);
  fail = true;
  assert.equal((await read(from, to, true)).stale, true);
  const next = await read(from, to);
  assert.equal(next.stale, true);
  assert.equal(next.fetchedAt, original.fetchedAt);
  assert.equal(calls, 3);
  fail = false;
  assert.equal((await read(from, to)).stale, false);
  assert.equal(calls, 4);
});

test("separate windows never reuse one another; mismatched upstream periods are rejected", async () => {
  const read = createOrionTrafficReader(async (start, end) => fixture(start, end));
  const otherFrom = "2026-11-10T00:00:00.000Z";
  assert.equal((await read(otherFrom, to)).data.from, otherFrom);
  assert.equal((await read(from, to)).data.from, from);
  const bad = createOrionTrafficReader(async () => fixture());
  await assert.rejects(bad(otherFrom, to), /different reporting window/);
});
