import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSolutionResources } from "./solutionResources";

const now = new Date("2026-10-02T12:00:00Z");
const item = (id: string, overrides = {}) => ({
  id, active: true, deletedAt: null as Date | null,
  publishedAt: new Date("2026-10-01T00:00:00Z") as Date | null, ...overrides,
});
const link = (id: string, displayOrder = 0, active = true) => ({
  c: item(id), link: { displayOrder, active },
});

test("saved ebook assignment appears alongside existing curated resources", () => {
  const result = mergeSolutionResources(
    [link("curated", 4)], [item("make-it-stick")], false, now,
  );
  assert.deepEqual(result.map((r) => r.c.id), ["curated", "make-it-stick"]);
  assert.equal(result[1].link.displayOrder, 5);
});

test("resources linked both ways appear only once and retain editorial order", () => {
  const result = mergeSolutionResources(
    [link("second", 2), link("first", 7)],
    [item("first"), item("second"), item("assigned"), item("assigned")], false, now,
  );
  assert.deepEqual(result.map((r) => [r.c.id, r.link.displayOrder]),
    [["second", 2], ["first", 7], ["assigned", 8]]);
});

test("an inactive explicit link is not reintroduced through its assignment", () => {
  assert.deepEqual(mergeSolutionResources(
    [link("suppressed", 0, false)], [item("suppressed")], false, now,
  ), []);
});

test("public lists hide inactive, deleted and future-dated resources from both sources", () => {
  const hidden = [
    item("draft", { active: false }),
    item("deleted", { deletedAt: now }),
    item("future", { publishedAt: new Date("2026-10-03T00:00:00Z") }),
  ];
  const pinned = hidden.map((c) => ({ c, link: { displayOrder: 0, active: true } }));
  assert.deepEqual(mergeSolutionResources(pinned, hidden, false, now), []);
  assert.deepEqual(mergeSolutionResources([], hidden, false, now), []);
});

test("preview retains hidden resources for editorial inspection", () => {
  const rows = mergeSolutionResources(
    [link("suppressed", 0, false)], [item("draft", { active: false })], true, now,
  );
  assert.deepEqual(rows.map((r) => r.c.id), ["suppressed", "draft"]);
});

test("new assignments work without pins; removed assignments disappear", () => {
  assert.equal(mergeSolutionResources([], [item("assigned")], false, now).length, 1);
  assert.deepEqual(mergeSolutionResources([], [], false, now), []);
});

test("null and today's publish dates remain visible", () => {
  const rows = mergeSolutionResources([], [
    item("undated", { publishedAt: null }),
    item("today", { publishedAt: new Date("2026-10-02T00:00:00Z") }),
  ], false, now);
  assert.deepEqual(rows.map((r) => r.c.id), ["undated", "today"]);
});