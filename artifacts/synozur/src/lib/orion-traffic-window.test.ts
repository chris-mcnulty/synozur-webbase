import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOrionWindow } from "./orion-traffic-window";

test("Orion windows use stable inclusive UTC days, not the viewer's timezone", () => {
  const expected = { from: "2026-11-14T00:00:00.000Z", to: "2026-11-20T23:59:59.999Z" };
  assert.deepEqual(computeOrionWindow("7", new Date("2026-11-20T00:01:00Z")), expected);
  assert.deepEqual(computeOrionWindow("7", new Date("2026-11-20T23:59:00Z")), expected);
});

test("year-to-date and rolling years handle new year and leap days", () => {
  assert.deepEqual(computeOrionWindow("ytd", new Date("2027-01-01T12:00:00Z")), {
    from: "2027-01-01T00:00:00.000Z", to: "2027-01-01T23:59:59.999Z",
  });
  assert.equal(computeOrionWindow("7", new Date("2028-03-01T12:00:00Z")).from, "2028-02-24T00:00:00.000Z");
  const annual = computeOrionWindow("365", new Date("2028-03-01T12:00:00Z"));
  assert.equal(Date.parse(annual.to) - Date.parse(annual.from) + 1, 365 * 86400_000);
});
