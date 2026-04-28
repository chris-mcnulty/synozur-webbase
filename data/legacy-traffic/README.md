# Legacy Traffic Imports

Drop legacy site analytics exports (Wix, GA4, etc.) into this folder. They are
read by the legacy traffic importer and merged into year-to-date reporting
alongside the live first-party tracking that runs on the new platform.

## File naming

```
<source>_<from-date>_<to-date>.<ext>
```

Examples:

- `wix_2026-01-01_2026-04-28.csv` — Wix Analytics export, Jan 1 → today.
- `wix_pages_2026-01-01_2026-04-28.csv` — per-page breakdown.
- `wix_final_2026-05-01_2026-MM-DD.csv` — the final export taken at cutover.

Use `_final_` in the filename for the cutover export so the importer can mark
the batch as superseding any overlapping dates from earlier batches.

## Expected shape (Wix Analytics)

The importer expects daily-grain rows. Wix's standard export columns are
typically:

| Column         | Required | Notes                                     |
| -------------- | -------- | ----------------------------------------- |
| Date           | yes      | ISO date or `MM/DD/YYYY`.                 |
| Page / URL     | yes      | Path on the legacy site (e.g. `/insights/...`). |
| Page Views     | yes      |                                           |
| Unique Visitors| no       | If present, stored.                       |
| Sessions       | no       |                                           |
| Avg. Time on Page | no    | Seconds or `mm:ss`; normalized to ms.     |
| Bounces        | no       |                                           |

If the export shape differs, paste a header row in the PR and the importer
column map will be updated to match.

## URL mapping

Legacy paths are resolved to the new site through `wix_redirects`
(`lib/db/src/schema/wixRedirects.ts`), then matched to `posts.slug` for blog
posts. Unresolved paths land in a triage table rather than being silently
dropped.

## Privacy

These exports are aggregate counts only — no PII, no IPs, no user agents.
They are safe to commit if small, but prefer keeping raw exports out of the
repo and pointing the importer at a local path if a file exceeds a few MB.
