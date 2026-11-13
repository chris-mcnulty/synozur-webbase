import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionId, isHashOnly } from "./section-anchor";

test("sectionId derives stable slug", () => {
  assert.equal(
    sectionId("Turn a priority into a working prototype and roadmap."),
    "turn-a-priority-into-a-working-prototype-and-roadmap",
  );
  assert.equal(sectionId("A & B"), "a-and-b");
  assert.equal(sectionId(""), undefined);
  assert.equal(sectionId(null), undefined);
});

test("isHashOnly", () => {
  assert.equal(isHashOnly("#x"), true);
  assert.equal(isHashOnly("/a#x"), false);
  assert.equal(isHashOnly("#"), false);
});
