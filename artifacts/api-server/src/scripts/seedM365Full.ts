/**
 * Orchestrates the full Microsoft 365 solution seed in the required order:
 *   1. seedBookings.ts  — ensures the m365-strategy-adoption-workshop booking row exists
 *   2. seedM365Solution.ts — upserts the microsoft-365-optimization solution row
 *      with acceleratorsHtml (Zenith callout) and faqHtml populated
 *
 * Both underlying scripts are idempotent (safe to re-run).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server seed:m365
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function run(script: string) {
  console.log(`\n=== Running ${script} ===`);
  execFileSync(
    process.execPath,
    ["--import", "tsx/esm", resolve(__dirname, script)],
    { stdio: "inherit", env: process.env },
  );
}

run("seedBookings.ts");
run("seedM365Solution.ts");

console.log("\nAll done.");
