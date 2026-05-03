/**
 * Smoke test for scripts/src/link-check.ts path resolution.
 *
 * Reproduces the CI invocation pattern (`pnpm --filter
 * @workspace/scripts run link-check` runs with cwd=`scripts/`) and
 * asserts the script resolves the allowlist + output dir against the
 * repo root regardless of cwd. Catches the regression flagged in
 * task #261's code review where repo-root-relative defaults were
 * silently resolved against the package dir.
 *
 * Invocation: `pnpm --filter @workspace/scripts run link-check:smoke`
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const scriptPath = resolve(__dirname, "link-check.ts");

const failures: string[] = [];
function assert(cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}

// Cleanup any stale artifacts from prior runs.
const outDir = join(repoRoot, ".link-check");
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

// Invoke the script with cwd intentionally set to the scripts/ dir to
// mirror `pnpm --filter @workspace/scripts run link-check`. We point
// LINK_CHECK_BASE_URL at an unreachable address so the crawl fails
// fast — we only care about whether the path-resolution code ran
// before the crawl. linkinator surfaces unreachable seeds as broken
// links rather than throwing, so the script will exit 1 (gate
// failure) rather than 2 (config error). Either way, the allowlist
// + output paths must resolve against the repo root.
const env = {
  ...process.env,
  LINK_CHECK_BASE_URL: "http://127.0.0.1:1",
  LINK_CHECK_ROOT: repoRoot,
  // Make the run finish quickly.
  LINK_CHECK_CONCURRENCY: "2",
};

const proc = spawnSync(
  "node",
  ["--import", "tsx/esm", scriptPath],
  {
    cwd: resolve(__dirname, ".."),
    env,
    encoding: "utf8",
    timeout: 60_000,
  },
);

const stdout = proc.stdout ?? "";
const stderr = proc.stderr ?? "";

assert(
  !stdout.includes("allowlist file not found") &&
    !stderr.includes("allowlist file not found"),
  `Expected allowlist to load from repo root, but the script reported it missing.\nstdout: ${stdout}\nstderr: ${stderr}`,
);

assert(
  existsSync(join(outDir, "results.json")),
  `Expected ${join(outDir, "results.json")} to exist after the run; the output dir was not resolved against the repo root.`,
);

assert(
  existsSync(join(outDir, "summary.md")),
  `Expected ${join(outDir, "summary.md")} to exist after the run.`,
);

if (existsSync(join(outDir, "results.json"))) {
  const raw = readFileSync(join(outDir, "results.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert(
    typeof parsed.totals?.client_error === "number",
    "results.json should report client_error count",
  );
  assert(
    typeof parsed.totals?.server_error === "number",
    "results.json should report server_error count",
  );
}

if (failures.length > 0) {
  console.error("link-check smoke test FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\nProcess stdout:\n${stdout}\nProcess stderr:\n${stderr}`);
  process.exit(1);
}
console.log("link-check smoke test passed.");
