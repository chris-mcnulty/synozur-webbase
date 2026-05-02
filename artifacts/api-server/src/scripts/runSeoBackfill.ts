/**
 * Launch-readiness L7 — bulk backfill `seoTitle` / `seoDescription` /
 * `ogImage` on every published artifact whose values are still blank.
 *
 * Wraps the same `runAudit()` + `applyAutofill()` helpers used by
 * `GET /api/seo/audit` and `POST /api/seo/audit/autofill` in
 * `routes/seo.ts`, so the operational behavior is identical to clicking
 * "Apply autofill" in the admin Site Health page — only this version
 * walks every kind in one pass and prints a per-kind summary suitable
 * for a launch-readiness checklist update.
 *
 * `applyAutofill` already guards against overwriting editor-set values
 * (`UPDATE … WHERE column IS NULL OR trim(column) = ''`), so re-running
 * after editorial review is safe.
 *
 * Usage:
 *   # Dry-run — print what would be touched, no DB writes.
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/runSeoBackfill.ts
 *
 *   # Apply across every kind.
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/runSeoBackfill.ts -- --apply
 *
 *   # Restrict to specific kinds (comma-separated).
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/runSeoBackfill.ts -- --apply \
 *     --kinds=insight,case-study,application,solution,service,model,workshop
 */
import { pool } from "@workspace/db";
import {
  runAudit,
  applyAutofill,
  type ArtifactKind,
  type AuditFinding,
} from "../lib/seoAudit.js";

const APPLY = process.argv.includes("--apply");
const KINDS_ARG = process.argv.find((a) => a.startsWith("--kinds="))?.slice(8);

const ALL_KINDS: readonly ArtifactKind[] = [
  "insight",
  "service",
  "solution",
  "application",
  "case-study",
  "model",
  "workshop",
];

function parseKinds(): Set<ArtifactKind> | null {
  if (!KINDS_ARG) return null;
  const parts = KINDS_ARG.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as ArtifactKind[];
  for (const p of parts) {
    if (!ALL_KINDS.includes(p)) {
      throw new Error(
        `Unknown --kinds entry: ${p}. Valid: ${ALL_KINDS.join(", ")}`,
      );
    }
  }
  return new Set(parts);
}

function summarize(findings: AuditFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    for (const m of f.missing) {
      const key = `${f.kind}:${m}`;
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const kindsFilter = parseKinds();

  console.log(`Running SEO audit (apply=${APPLY})…`);
  const report = await runAudit();

  console.log("\nPer-kind totals (published / missing-some-field):");
  for (const kind of ALL_KINDS) {
    const t = report.totals[kind];
    if (kindsFilter && !kindsFilter.has(kind)) continue;
    console.log(`  ${kind.padEnd(11)}  ${t.total.toString().padStart(4)} total · ${t.missing.toString().padStart(4)} missing`);
  }

  let findings = report.findings;
  if (kindsFilter) {
    findings = findings.filter((f) => kindsFilter.has(f.kind));
  }

  const breakdown = summarize(findings);
  if (Object.keys(breakdown).length > 0) {
    console.log("\nFindings by (kind, missing field):");
    for (const [key, count] of Object.entries(breakdown).sort()) {
      console.log(`  ${key.padEnd(40)}  ${count}`);
    }
  } else {
    console.log("\nNo findings — every published artifact already has SEO data set.");
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log(
      `\nDry-run complete. ${findings.length} finding(s) across ${new Set(findings.map((f) => f.kind)).size} kind(s).`,
    );
    console.log("Re-run with --apply to write suggestions to empty columns.");
    await pool.end();
    return;
  }

  console.log(`\nApplying autofill to ${findings.length} finding(s)…`);
  const touched = await applyAutofill(findings);

  console.log("\nRows touched per kind:");
  let totalTouched = 0;
  for (const kind of ALL_KINDS) {
    if (kindsFilter && !kindsFilter.has(kind)) continue;
    const n = touched[kind] ?? 0;
    totalTouched += n;
    console.log(`  ${kind.padEnd(11)}  ${n.toString().padStart(4)}`);
  }
  console.log(`\nDone. Total rows touched: ${totalTouched}.`);
  console.log(
    "Note: only blank columns are written. Re-run after editorial review to pick up newly-blank rows.",
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
