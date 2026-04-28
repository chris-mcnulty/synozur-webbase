# Legacy Traffic Imports

Drop legacy site analytics exports (Wix, GA4, etc.) into this folder. They are
read by the legacy traffic importer and merged into year-to-date reporting
alongside the live first-party tracking that runs on the new platform.

## File naming

```
<source>_<from-date>_<to-date>.<ext>
```

Examples:

- `wix_2026-01-01_2026-04-28.csv` — Wix Analytics detail export, Jan 1 → today.
- `wix_pages_2026-01-01_2026-04-28.csv` — per-page rollup (used by `reconcile`).
- `wix_final_2026-05-01_2026-MM-DD.csv` — the final export taken at cutover.

Use `_final_` in the filename for the cutover export as a naming convention,
but note that the importer only marks a batch as final when invoked with the
`--final` flag. For the cutover export, include `--final` so the batch
supersedes any overlapping dates from earlier batches.

## Expected shape (Wix Analytics — detail-row export)

The current importer is matched to Wix's per-session detail-row export, not
the per-day rollup. The relevant headers are:

| Column                   | Required | Notes                                                |
| ------------------------ | -------- | ---------------------------------------------------- |
| Page path                | yes      | Path on the legacy site (e.g. `/post/...`).          |
| Date                     | yes      | ISO date or `MM/DD/YYYY`.                            |
| Session hour             | no       | 0–23, used for session bucketing.                    |
| Browser, Browser version | no       | Stored on `traffic_sessions`.                        |
| Device type              | no       | Mobile / Desktop / Tablet.                           |
| Operating system         | no       |                                                      |
| City, Country, Region    | no       | Country full names are mapped to ISO 2-letter codes. |
| IP address               | no       | Hashed (sha256) before persisting; never stored raw. |
| Page URL                 | no       | Used to extract referrer host.                       |
| Traffic category, Traffic source, Traffic source URL | no | Mapped onto the existing `traffic_source` enum. AI referrers (Perplexity, OpenAI, Claude, etc.) are promoted to the `ai` bucket even when Wix logged them as Direct. |
| UTM campaign source / medium / name / content / keywords | no | Stored on the session row.                |
| Visitor type             | no       | New / Returning.                                     |
| Page views               | yes      | Aggregate count for this (path, session, hour) row.  |
| Site sessions            | no       | Sanity-check field.                                  |
| Unique visitors          | no       | Sanity-check field.                                  |
| Avg. session duration    | no       | `Hh, Mm, Ss` text format → ms.                       |
| Avg. time on page        | no       | Same format → ms; copied to `time_on_page_ms`.       |
| Bounce rate              | no       | `0%`–`100%`; stored as integer 0–100.                |

The companion per-page rollup export (e.g. `wix_pages_*.csv`) has just
`Page path, Page views, Site sessions, Unique visitors` and is consumed only
by the `reconcile` CLI for sanity-check totals.

If a future export has a different column shape, paste the header row in the
PR and the importer column map will be updated to match.

## URL mapping

Legacy paths are resolved to the new site through `wix_redirects`
(`lib/db/src/schema/wixRedirects.ts`), then matched to `posts.slug` for blog
posts. Unresolved paths land in `legacy_traffic_unmapped` for editor triage
rather than being silently dropped.

## Privacy

The detail-row exports described above include IP addresses and
city/postal/region columns. Treat any file with IPs, geo data, user-agent
strings, or visitor-level identifiers as sensitive input: keep it local
only, do not commit it to this repo (the folder-level `.gitignore` blocks
raw exports by default), and point the importer at a local path. Inside the
database the importer hashes IPs before insert — raw IPs are never
persisted — but the source CSV is still sensitive until imported and
deleted.

Only sanitized aggregate-only files (just `Page path` + counts, with IPs,
geo, and user-agent fields removed) should be considered for commit, e.g.
as test fixtures.
