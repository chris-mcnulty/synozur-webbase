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

The importer guarantees idempotency at two levels:

- **Batch / file level**: `legacy_traffic_batches` keys on `(source_system,
  source_file_sha256)`. Re-importing the exact same file detects the
  existing batch row and skips the entire write. The whole write phase
  (batch row + sessions + pageviews + post_views + unmapped) runs inside a
  single DB transaction, so a crash mid-import rolls back atomically — the
  batch row only persists when the import completes successfully, and a
  retry can run cleanly.
- **Session level**: each session row carries a `legacy_session_key`
  derived from `(sourceSystem, date, hour, ip, ua, country, visitor type)`,
  and the DB enforces composite uniqueness on `(source_system,
  legacy_session_key)`. Re-running an import that touches the same session
  from a previous batch is a no-op for that session.

Pageview rows are not independently deduplicated — they are tied to the
batch and roll back with it. If you need to replay a partially-imported
batch, do so with the same input file: the SHA-256 batch key handles the
overlap.

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
