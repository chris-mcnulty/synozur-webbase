# PR #48 Schema Push & Backfill — Run Log (Task #159)

Date: 2026-04-26

## Steps Executed

### 1. Alt-text backfill (pre-schema-push)
```
pnpm --filter @workspace/api-server exec tsx src/scripts/backfillMediaAltText.ts
```
Output:
```
Backfill complete. updated=227; skipped=0 (already non-empty rows are not selected); candidates=227.
```

### 2. Schema push
```
pnpm --filter @workspace/db run push
```
Output:
```
Reading config file '/home/runner/workspace/lib/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] Pulling schema from database...
[✓] Changes applied
```
Tables created: `collateral_resources`, `publish_blocks`, `cwv_samples`
Constraint applied: `media.alt_text` NOT NULL + `media_alt_text_non_empty` CHECK

### 3. Collateral resources backfill (post-schema-push)
```
pnpm --filter @workspace/api-server exec tsx src/scripts/backfillCollateralResources.ts
```
Output:
```
Backfill complete. inserted=7 (media-backed=0, external=7); skipped=0 already-has-resources, 0 empty download_url; total candidates=7.
```

## Final Verification Query

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'collateral_resources') AS collateral_resources_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'publish_blocks') AS publish_blocks_exists,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'cwv_samples') AS cwv_samples_exists,
  (SELECT COUNT(*) FROM media WHERE alt_text IS NULL OR length(trim(alt_text)) = 0) AS media_null_or_empty_alt_text,
  (SELECT COUNT(*) FROM collateral_resources) AS collateral_resources_rows,
  (SELECT COUNT(*) FROM media) AS total_media_rows;
```

Results:
| collateral_resources_exists | publish_blocks_exists | cwv_samples_exists | media_null_or_empty_alt_text | collateral_resources_rows | total_media_rows |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 0 | 7 | 423 |

All checks pass. ✓
