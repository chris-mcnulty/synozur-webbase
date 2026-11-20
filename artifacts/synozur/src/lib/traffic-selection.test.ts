import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSelection, serializeSelection, toggleSelection, resolveSelection,
  mergeDimension, mergeDaily, applySnapshot,
} from "./traffic-selection";

test("default selection is WWW (synozur) and serializes to no param", () => {
  assert.deepEqual(parseSelection(null), ["synozur"]);
  assert.deepEqual(parseSelection(" , "), ["synozur"]);
  assert.equal(serializeSelection(["synozur"]), null);
  assert.equal(serializeSelection(["synozur", "orion"]), "synozur,orion");
  assert.deepEqual(parseSelection("orion,all"), ["all"]);
});

test("toggle falls back to WWW when emptied; all is exclusive", () => {
  assert.deepEqual(toggleSelection(["orion"], "orion"), ["synozur"]);
  assert.deepEqual(toggleSelection(["all"], "orion"), ["orion"]);
  assert.deepEqual(toggleSelection(["synozur"], "all"), ["all"]);
});

test("orion never reaches local queries, including All", () => {
  const known = ["synozur", "wix-legacy", "orion"];
  const all = resolveSelection(["all"], known);
  assert.deepEqual(all.localSlugs, ["synozur", "wix-legacy"]);
  assert.equal(all.includeOrion, true);
  assert.equal(all.mode, "mixed");
  const only = resolveSelection(["orion"], known);
  assert.deepEqual(only.localSlugs, []);
  assert.equal(only.mode, "orion");
  assert.equal(resolveSelection(["synozur"], known).mode, "local");
});

test("mixed dimensions keep units separate and do not zero-fill unavailable sources", () => {
  const rows = mergeDimension([{ key: "mobile", count: 3 }], [{ key: "mobile", count: 10 }, { key: "desktop", count: 4 }]);
  assert.deepEqual(rows.find((r) => r.key === "mobile"), { key: "mobile", local: 3, orion: 10 });
  assert.deepEqual(rows.find((r) => r.key === "desktop"), { key: "desktop", local: 0, orion: 4 });
  const unavailable = mergeDimension([{ key: "US", count: 2 }], null);
  assert.equal(unavailable[0]!.orion, null);
});

test("daily merge filters to window and keeps separate series", () => {
  const rows = mergeDaily(
    [{ day: "2026-01-01", pageviews: 5, sessions: 2 }, { day: "2025-12-01", pageviews: 99, sessions: 9 }],
    [{ date: "2026-01-02", count: 7 }, { date: "2026-02-01", count: 50 }],
    { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T23:59:59.999Z" },
  );
  assert.deepEqual(rows, [
    { date: "2026-01-01", localPageviews: 5, localSessions: 2, orionVisits: 0 },
    { date: "2026-01-02", localPageviews: 0, localSessions: 0, orionVisits: 7 },
  ]);
  assert.equal(mergeDaily(null, [{ date: "2026-01-02", count: 1 }], { from: "2026-01-01", to: "2026-01-03" })[0]!.localPageviews, undefined);
});

test("snapshot refresh replaces rather than accumulates", () => {
  assert.deepEqual(applySnapshot({ totalVisits: 10 }, { totalVisits: 12 }), { totalVisits: 12 });
});

import { annualWindow, combineSessions, withCombinedSessions } from "./traffic-selection";

test("annual window: Jan 1 UTC to today for current year, Dec 31 for prior years", () => {
  const now = new Date("2026-03-05T15:00:00Z");
  assert.deepEqual(annualWindow(2026, now), { from: "2026-01-01T00:00:00.000Z", to: "2026-03-05T23:59:59.999Z" });
  assert.deepEqual(annualWindow(2025, now), { from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.999Z" });
  assert.equal(annualWindow(2024, now).to, "2024-12-31T23:59:59.999Z");
});

test("sessions add Orion visits once and flag partial when Orion missing", () => {
  assert.deepEqual(combineSessions(100, 40, true, true), { value: 140, partial: false });
  assert.deepEqual(combineSessions(100, null, true, true), { value: 100, partial: true });
  assert.deepEqual(combineSessions(null, 40, true, false), { value: 40, partial: false });
  assert.deepEqual(combineSessions(100, 999, false, true), { value: 100, partial: false });
  assert.deepEqual(combineSessions(null, null, true, false), { value: null, partial: true });
  assert.deepEqual(combineSessions(null, null, false, true), { value: null, partial: true });
  assert.deepEqual(combineSessions(null, null, true, true), { value: null, partial: true });
  assert.deepEqual(combineSessions(0, 0, true, true), { value: 0, partial: false });
  assert.equal(withCombinedSessions([{ date: "d", localSessions: 2, orionVisits: 3, localPageviews: 9 }])[0]!.sessions, 5);
});
