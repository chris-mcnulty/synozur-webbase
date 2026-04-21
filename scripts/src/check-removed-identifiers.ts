/**
 * Guard that fails the build if the obsolete lookup maps from #105 are
 * reintroduced anywhere in the code tree. These constants were removed
 * when case studies, applications, and the workshops-by-service rail
 * started using real foreign keys (#100) and polymorphic taxonomy (#99)
 * — re-adding them is always wrong and silently regresses filtered
 * rails when services are renamed.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run check:removed-identifiers
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const BANNED: Array<{ name: string; reason: string }> = [
  {
    name: "PILLAR_BY_SLUG",
    reason:
      "Use ?serviceId= / ?solutionId= on library endpoints; the pillar heuristic silently breaks on rename.",
  },
  {
    name: "WORKSHOP_CATEGORIES_BY_SLUG",
    reason: "Use /api/workshops?serviceId=... — workshops now carry a serviceId FK.",
  },
  {
    name: "WORKSHOP_CATEGORIES_BY_SERVICE",
    reason:
      "Same as WORKSHOP_CATEGORIES_BY_SLUG — the local rename doesn't fix the underlying coupling.",
  },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/src → scripts → <repo root>
const ROOT = resolve(__dirname, "../..");

const SCAN_DIRS = [
  "artifacts/api-server/src",
  "artifacts/synozur/src",
  "lib/db/src",
];

const INCLUDE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo"]);

// Files that are allowed to reference the banned names so this script
// itself (and the backlog / docs) don't trigger a self-failure.
const SELF_PATH = relative(ROOT, resolve(__dirname, "./check-removed-identifiers.ts"));
const ALLOWLIST = new Set<string>([SELF_PATH]);

type Hit = { file: string; line: number; match: string; reason: string };

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (stats.isFile() && INCLUDE_EXT.test(name)) out.push(full);
  }
}

function scanFile(path: string): Hit[] {
  const rel = relative(ROOT, path);
  if (ALLOWLIST.has(rel)) return [];
  const content = readFileSync(path, "utf-8");
  const hits: Hit[] = [];
  for (const { name, reason } of BANNED) {
    let idx = 0;
    while ((idx = content.indexOf(name, idx)) !== -1) {
      // Require word-boundary on both sides so substrings (e.g. if a
      // longer identifier happened to contain the banned name) don't
      // spuriously match.
      const before = idx === 0 ? "" : content[idx - 1];
      const after = content[idx + name.length] ?? "";
      const isWord = /[A-Za-z0-9_]/;
      if (!isWord.test(before) && !isWord.test(after)) {
        const line = content.slice(0, idx).split("\n").length;
        hits.push({ file: rel, line, match: name, reason });
      }
      idx += name.length;
    }
  }
  return hits;
}

function main(): void {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(resolve(ROOT, dir), files);

  const hits: Hit[] = [];
  for (const f of files) hits.push(...scanFile(f));

  if (hits.length === 0) {
    console.log(
      `OK: ${files.length} source files scanned; no removed identifiers present.`,
    );
    process.exit(0);
  }

  console.error(`Found ${hits.length} forbidden identifier reference(s):\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.match}`);
    console.error(`    → ${h.reason}`);
  }
  console.error(
    "\nThese constants were removed in #105. Use the real FK-based endpoints instead.",
  );
  process.exit(1);
}

main();
