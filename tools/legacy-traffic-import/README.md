# Legacy Traffic Importer

Imports analytics exports from the legacy Wix site into the live
`traffic_sessions` / `traffic_pageviews` tables, tagged with
`source_system = 'wix'` so YTD reporting includes both legacy and native
traffic in one query.

## Usage

```bash
pnpm --filter @workspace/legacy-traffic-import import \
  --file data/legacy-traffic/wix_2026-01-01_2026-04-29.csv

# Dry run — parses, resolves URLs, prints stats, does not write
pnpm --filter @workspace/legacy-traffic-import import \
  --file data/legacy-traffic/wix_2026-01-01_2026-04-29.csv \
  --dry-run

# Final cutover import (after the legacy site is taken down)
pnpm --filter @workspace/legacy-traffic-import import \
  --file data/legacy-traffic/wix_final_2026-05-01_2026-MM-DD.csv \
  --final
```

## Idempotency

Each session row carries a `legacy_session_key` derived from
`(date, hour, ip, ua, country, visitor type)`. Re-running the importer with
the same input file is a no-op for sessions; pageviews are deduped by the
`(import_batch_id, legacy_session_key, path)` triple. The batch row keys on
the file's SHA-256, so re-importing the exact same file is also a no-op.

## URL resolution

Legacy paths are resolved through `wix_redirects` (chained, max depth 5),
then matched to `posts.slug` for blog post detection. Paths that don't
resolve are written to `legacy_traffic_unmapped` for editor triage rather
than silently dropped — they still get imported (with `resolved_path = NULL`),
but they show up in the unmapped report.

## Reconciliation

After import, run:

```bash
pnpm --filter @workspace/legacy-traffic-import reconcile \
  --batch <batch-id> \
  --against data/legacy-traffic/wix_pages_2026-01-01_2026-04-29.csv
```

This compares per-page totals from the imported batch against the per-page
rollup file Wix generates as a separate export, and reports any mismatches.
