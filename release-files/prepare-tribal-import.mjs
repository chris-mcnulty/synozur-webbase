// Offline only. Does not contact or modify any server.
// node release-files/prepare-tribal-import.mjs fresh-production-export.json /tmp/tribal-reviewed-import.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function mergeTribalExport(current, patch) {
  if (current.format !== "synozur-landing-page" || current.version !== 1 ||
      current.page?.slug !== "tribal-first-nations") {
    throw new Error("Select a fresh CMS export of the existing tribal-first-nations page.");
  }
  if (current.page.status !== "published" || current.page.active !== true ||
      current.page.featured !== false || current.page.libraryListed !== true) {
    throw new Error("Visibility differs from the approved baseline. Stop and review; do not overwrite it.");
  }
  const allowed = ["title", "subtitle", "description", "blocks", "seoTitle", "seoDescription", "ogImageUrl", "tags"];
  if (Object.keys(patch).some((key) => !allowed.includes(key)) ||
      allowed.some((key) => !(key in patch))) {
    throw new Error("Unexpected patch fields; use the reviewed content-only release file.");
  }
  // Preserve slug, hero, status, dates, classification and all production-only references.
  // No force flag: CMS will require explicit conflict confirmation.
  return { format: current.format, version: current.version, page: { ...current.page, ...patch } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output || resolve(input) === resolve(output)) {
    throw new Error("Provide a fresh export and a DIFFERENT output path. Keep the original for restoration.");
  }
  const patch = JSON.parse(readFileSync(new URL("./tribal-first-nations.landing-page.json", import.meta.url), "utf8"));
  writeFileSync(output, JSON.stringify(mergeTribalExport(JSON.parse(readFileSync(input, "utf8")), patch), null, 2) + "\n", { flag: "wx" });
  console.log("Prepared offline import. Review against the original export before any production save.");
}
