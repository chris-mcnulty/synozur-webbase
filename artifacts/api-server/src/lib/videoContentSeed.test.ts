import test from "node:test";
import assert from "node:assert/strict";
import { videoContentFieldsFromWix } from "./videoContentSeed";

test("maps Wix short description to the video summary and full description to the body", () => {
  const fullDescription = JSON.stringify({
    nodes: [
      {
        type: "PARAGRAPH",
        nodes: [
          {
            type: "TEXT",
            textData: { text: "The complete webinar description." },
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    videoContentFieldsFromWix(
      fullDescription,
      '<p class="font_8">A concise card summary.</p>',
    ),
    {
      shortDescription: "A concise card summary.",
      bodyHtml: "<p>The complete webinar description.</p>",
    },
  );
});

test("falls back to the full description when the Wix short description is blank", () => {
  const fullDescription = JSON.stringify({
    nodes: [
      {
        type: "PARAGRAPH",
        nodes: [
          {
            type: "TEXT",
            textData: { text: "Fallback summary and body." },
          },
        ],
      },
    ],
  });

  assert.deepEqual(videoContentFieldsFromWix(fullDescription, ""), {
    shortDescription: "Fallback summary and body.",
    bodyHtml: "<p>Fallback summary and body.</p>",
  });
});