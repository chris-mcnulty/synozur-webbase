import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChapterPublicationReview } from "./ChapterPublicationReview";

test("older publication exports show missing checks rather than passing", () => {
  const html = renderToStaticMarkup(<ChapterPublicationReview />);
  assert.match(html, /Not checked: this older export/);
  assert.match(html, /not saved approvals/);
  assert.match(html, /explicit editorial approval/);
  assert.match(html, /explicit ACX authorization/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 9);
});

test("publication review labels estimates, warnings and unmeasurable silence explicitly", () => {
  const html = renderToStaticMarkup(<ChapterPublicationReview checks={{
    method: "Synthetic advisory measurements",
    requirementsUrl: "https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements",
    noiseFloor: { status: "warning", rmsDb: -52, seconds: null, detail: "Noise needs review" },
    leadingRoomTone: { status: "unmeasurable", rmsDb: null, seconds: 2, detail: "Digital silence is not room tone" },
    trailingRoomTone: { status: "review", rmsDb: -65, seconds: 3, detail: "Listen to confirm room tone" },
  }} />);
  assert.match(html, /Warning/);
  assert.match(html, /Not measurable/);
  assert.match(html, /Listening review required/);
  assert.match(html, /−60 dB RMS/);
  assert.match(html, /-52.0 dB RMS/);
  assert.match(html, /3.0 s estimated/);
  assert.doesNotMatch(html, /Not checked: this older export/);
});
