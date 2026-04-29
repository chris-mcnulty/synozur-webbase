// #127 Phase 3-B — GCS → SharePoint Embedded migration CLI.
//
// One-shot, resumable, additive-only. The core migration logic lives in
// lib/storage/spe/migrationRunner.ts and is shared with the admin API;
// this file is only the CLI wrapper.
//
// What this script DOES NOT DO, by design, ever:
//   • delete from GCS
//   • rewrite media.storage_key
//   • touch any row that already has spe_file_id (re-running is safe)
//
// Usage:
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe --dry-run
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe --limit 10
//
//   Or inline env for production:
//   DATABASE_URL="<prod-url>" NODE_ENV=production \
//     pnpm --filter @workspace/api-server migrate:gcs-to-spe --dry-run
//
// Env required (same as the api-server itself):
//   DATABASE_URL, ENTRA_TENANT_ID, ENTRA_APP_CLIENT_ID,
//   ENTRA_APP_CLIENT_SECRET, PUBLIC_OBJECT_SEARCH_PATHS,
//   PRIVATE_OBJECT_DIR.
//
// site_settings prerequisites:
//   • spe_container_id_dev (or _prod) populated for the active
//     environment — provision via the SPE admin page.
//   • spe_storage_enabled = true

import { runMigration, fetchMigrationCounts } from "../lib/storage/spe/migrationRunner";
import { SpeNotEnabledError } from "../lib/storage/spe/fileStorage";

interface Args {
  dryRun: boolean;
  limit: number | null;
  pageSize: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, limit: null, pageSize: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // pnpm passes "--" as an arg separator when you use `-- --flag`.
    // Skip it silently so both invocation styles work:
    //   migrate:gcs-to-spe -- --dry-run   (old)
    //   migrate:gcs-to-spe --dry-run      (preferred)
    if (a === "--") continue;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a positive integer");
      out.limit = n;
    } else if (a === "--page-size") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--page-size needs a positive integer");
      out.pageSize = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: migrate:gcs-to-spe [--dry-run] [--limit N] [--page-size N]",
          "",
          "  --dry-run      list rows that would be migrated; don't touch SPE or DB",
          "  --limit N      stop after N rows successfully migrated",
          "  --page-size N  rows fetched per DB page (default 50)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const counts = await fetchMigrationCounts();
  console.log(
    `media: ${counts.total} total · ${counts.alreadyMigrated} already migrated · ${counts.pending} pending` +
      (args.dryRun ? " (DRY RUN)" : "") +
      (args.limit ? ` (limit=${args.limit})` : ""),
  );

  if (counts.pending === 0) {
    console.log("Nothing to do.");
    return;
  }

  let result;
  try {
    result = await runMigration({
      dryRun: args.dryRun,
      limit: args.limit,
      pageSize: args.pageSize,
      onRow: (id, ok, detail) => {
        if (ok) console.log(`  ✓ ${id} → ${detail}`);
        else console.error(`  ✗ ${id}: ${detail}`);
      },
    });
  } catch (err) {
    if (err instanceof SpeNotEnabledError) {
      console.error(`SPE not configured: ${(err as Error).message}`);
    } else {
      console.error(`Migration failed:`, err);
    }
    process.exit(1);
  }

  console.log(
    `\nDone. processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}` +
      (args.dryRun ? " (DRY RUN — nothing written)" : ""),
  );

  if (result.failures.length > 0) {
    console.error(`\n${result.failures.length} failures:`);
    for (const f of result.failures) console.error(`  ${f.id}  ${f.reason}`);
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
