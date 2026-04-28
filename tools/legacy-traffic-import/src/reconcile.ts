/**
 * Reconcile a batch's per-page totals against Wix's per-page rollup export
 * (file like `traffic_2026-01-01-2026-04-29.csv` with just
 *  Page path, Page views, Site sessions, Unique visitors).
 *
 *   pnpm --filter @workspace/legacy-traffic-import reconcile \
 *     --batch <uuid> --against data/legacy-traffic/<rollup>.csv
 *
 * Reports per-path mismatches between what we imported and what Wix's own
 * rollup says. Useful as a sanity check immediately after import.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import {
  db,
  trafficPageviewsTable,
  legacyTrafficBatchesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizePath } from "./util";

interface CliArgs {
  batchId: string;
  against: string;
}

function parseArgs(argv: string[]): CliArgs {
  let batchId: string | null = null;
  let against: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--batch") batchId = argv[++i] ?? null;
    else if (arg === "--against") against = argv[++i] ?? null;
  }
  if (!batchId || !against) {
    process.stderr.write(
      "Usage: reconcile --batch <uuid> --against <rollup.csv>\n",
    );
    process.exit(2);
  }
  return { batchId, against };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const absPath = path.resolve(args.against);
  if (!fs.existsSync(absPath)) {
    process.stderr.write(`File not found: ${absPath}\n`);
    process.exit(1);
  }

  const [batch] = await db
    .select({
      id: legacyTrafficBatchesTable.id,
      sourceFile: legacyTrafficBatchesTable.sourceFile,
    })
    .from(legacyTrafficBatchesTable)
    .where(sql`${legacyTrafficBatchesTable.id} = ${args.batchId}`)
    .limit(1);
  if (!batch) {
    process.stderr.write(`Batch not found: ${args.batchId}\n`);
    process.exit(1);
  }

  const rollupRecords = parse(fs.readFileSync(absPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  }) as Record<string, string>[];
  const expected = new Map<string, number>();
  for (const r of rollupRecords) {
    const p = normalizePath(r["Page path"] ?? "");
    const pv = Number(r["Page views"] ?? "0");
    if (!Number.isFinite(pv)) continue;
    expected.set(p, (expected.get(p) ?? 0) + pv);
  }

  const importedRows = await db
    .select({
      path: trafficPageviewsTable.path,
      pageviews: sql<number>`coalesce(sum(${trafficPageviewsTable.pageviewCount}), 0)::int`,
    })
    .from(trafficPageviewsTable)
    .where(sql`${trafficPageviewsTable.importBatchId} = ${args.batchId}`)
    .groupBy(trafficPageviewsTable.path);
  const imported = new Map<string, number>();
  for (const r of importedRows) imported.set(r.path, r.pageviews);

  const allPaths = new Set<string>([...expected.keys(), ...imported.keys()]);
  const mismatches: Array<{ path: string; expected: number; imported: number; delta: number }> = [];
  let expectedTotal = 0;
  let importedTotal = 0;
  for (const p of allPaths) {
    const e = expected.get(p) ?? 0;
    const i = imported.get(p) ?? 0;
    expectedTotal += e;
    importedTotal += i;
    if (e !== i) mismatches.push({ path: p, expected: e, imported: i, delta: i - e });
  }
  mismatches.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  process.stdout.write(
    [
      `Batch:    ${batch.id} (${batch.sourceFile})`,
      `Rollup:   ${absPath}`,
      `Expected pageviews total: ${expectedTotal}`,
      `Imported pageviews total: ${importedTotal}`,
      `Delta:                    ${importedTotal - expectedTotal}`,
      `Paths checked:            ${allPaths.size}`,
      `Mismatched paths:         ${mismatches.length}`,
      "",
    ].join("\n"),
  );

  if (mismatches.length > 0) {
    process.stdout.write(`Top 20 mismatches by absolute delta:\n`);
    for (const m of mismatches.slice(0, 20)) {
      process.stdout.write(
        `  ${m.delta > 0 ? "+" : ""}${m.delta.toString().padStart(6)}  ` +
          `(expected ${m.expected.toString().padStart(5)}, imported ${m.imported.toString().padStart(5)})  ${m.path}\n`,
      );
    }
  } else {
    process.stdout.write(`All paths match.\n`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`Reconcile failed: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
