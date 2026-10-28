import assert from "node:assert/strict";
import test from "node:test";
import { WorkshopPatch } from "./workshops";

test("WorkshopPatch accepts clearing an optional secondary CTA", () => {
  const parsed = WorkshopPatch.safeParse({
    title: "Company Operating System Bootcamp",
    secondaryCTA: null,
  });

  assert.equal(parsed.success, true);
});