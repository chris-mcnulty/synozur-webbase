import { restorationPreflight } from "./restore-preflight.js";

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const outputArg = args.find((arg) => arg.startsWith("--output-dir="));
  if (args.some((arg) => arg !== "--json" && !arg.startsWith("--output-dir=")) ||
      (outputArg !== undefined && !outputArg.slice("--output-dir=".length))) {
    throw new Error("Usage: restore:preflight [--json] [--output-dir=<dataset-directory>]");
  }
  const report = await restorationPreflight(outputArg?.slice("--output-dir=".length));
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Offline restoration preflight: ${report.ok ? "PASS" : "FAIL"}`);
    console.log(`${report.postsPath}\n${report.posts} valid posts; ${report.imageFiles} unique image paths`);
    for (const issue of report.errors) console.error(`ERROR ${issue.code}: ${issue.location}: ${issue.message}`);
    for (const issue of report.warnings) console.warn(`WARNING ${issue.code}: ${issue.location}: ${issue.message}`);
    console.log(`${report.errors.length} errors; ${report.warnings.length} warnings. No imports, network requests, or database access performed.`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(`Offline restoration preflight failed: ${String(err)}`);
  process.exitCode = 1;
});
