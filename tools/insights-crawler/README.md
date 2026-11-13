# Insights Crawler

A standalone, build-time crawler that mirrors the public Wix-hosted blog at
`https://www.synozur.com/insights` into a typed JSON dataset that downstream
tasks (e.g. the public reading experience + DB ingest) can consume without
re-crawling.

The discovery/crawl commands acquire data; the separate ingest and author-repair
commands **do write to the application database**. The offline restoration
preflight below does neither. None of these commands updates the live site's UI.

## Historical dataset retention and offline restoration preflight

The tracked `output/` directory is historical Wix migration evidence, **not
disposable generated output**. Keep it intact, including reports and discovery
inputs. Today's live site cannot reproduce the historical Wix source. Do not
run discovery/crawl (especially `--force`) as a restoration check or replace the
historical dataset with a fresh crawl.

```bash
# Read-only; no credentials, network, storage uploads, or database needed.
pnpm --filter @workspace/insights-crawler run restore:preflight
pnpm --filter @workspace/insights-crawler run restore:preflight -- --json

# Check a separately restored copy without changing consumer paths:
pnpm --filter @workspace/insights-crawler run restore:preflight -- --output-dir=/path/to/restored/output

# Offline regression suite (includes a deliberately missing-image fixture):
pnpm --filter @workspace/insights-crawler run test:restore-preflight
```

The preflight validates `posts.json` with `PostsFileSchema` from `src/schema.ts`,
rejects an empty dataset/duplicate slugs, and checks every hero/body image plus
local HTML image/srcset, inline Markdown image and SEO image reference. Files
must stay within the dataset (including symlink targets), be regular readable
files, match recorded byte sizes where supplied, and decode successfully with
Sharp. Remote URLs are never fetched. Failures include post/field and image
paths; all detected errors are reported. Exit status is 0 on pass, 1 on failure.
Partial/failed crawl statuses are warnings requiring manual review; ingest skips
failed posts. Schema-invalid records cannot supply reliable image references,
but valid sibling records are still checked.

A pass confirms local input readiness, **not** a database restoration, current
CMS parity, or cryptographic proof of historical identity (no original checksum
manifest exists here). No content is imported or rewritten. Tests use temporary
datasets, never remove images from the historical dataset, and require no app
server. The committed negative fixture is `src/fixtures/missing-image/posts.json`;
checking its directory must fail with `image_missing`.

### Consumers that must move together under a separately approved plan

| Consumer | Historical inputs / operational behavior |
| --- | --- |
| `src/ingest.ts` | Resolves `../output/posts.json` and local images relative to the script; schema-validates then uploads images and writes posts/media/authors/categories/audit rows. Requires `--yes`; not an offline check. |
| `src/backfill-authors.ts` | Resolves the same dataset and schema; creates author accounts and updates post author links/audit rows. Requires `--yes`; not an offline check. |
| `../../artifacts/api-server/src/scripts/fixPostAuthors.ts` | Reads post slugs/author names and creates/assigns canonical author accounts; no `--yes` guard. Its current four-level relative path resolves under `artifacts/tools`, not repository `tools`; this pre-existing path issue is not repaired or executed by preflight. |
| `src/restore-preflight.ts` | Defaults to the historical output beside this tool; accepts an alternate restored output directory for offline verification. |

Follow the [repository retention constraints](../../docs/repository-cleanup/README.md).
No shrinking, deletion, untracking, ignoring or relocation is authorized here.
A separate approval must select durable storage, preserve provenance/metadata,
record original paths/sizes/SHA-256, verify re-downloaded hashes and restoration,
and update **all** consumers together before any retention change. An ignored
local copy, old Git history, or a successful earlier import is not a verified
archive.

## What it produces

All output goes under `output/`:

- `output/discovered.json` — every post URL discovered from
  `blog-posts-sitemap.xml`, with last-modified date and the hero image URL Wix
  advertises in its sitemap.
- `output/posts.json` — the final dataset. An array of typed `Post` objects
  validated against [`src/schema.ts`](./src/schema.ts). Sorted deterministically
  (publish date desc, slug asc); image URLs are local relative paths.
- `output/images/<slug>/...` — every hero and inline image downloaded from
  `static.wixstatic.com`, resized to a max width of 1920px (PNG/JPEG/WebP only).
- `output/report.md` — a human-readable run report: counts, byte totals, and a
  per-post status table (ok / partial / failed) with notes.
- `output/.cache/<slug>.html` — raw HTML cache used by historical crawl runs;
  retain historical evidence under the policy above rather than deleting it
  for a clean re-fetch.

## How to run

These are acquisition commands, **not restoration verification**. Do not run
them against the preserved historical `output/` without a separately approved
preservation plan.

```bash
# 1. Discover post URLs from the public sitemap.
pnpm --filter @workspace/insights-crawler run discover

# 2. Crawl every discovered post (resumable, idempotent).
pnpm --filter @workspace/insights-crawler run crawl

# Or both in one shot:
pnpm --filter @workspace/insights-crawler run all
```

### Re-crawl a single post

```bash
pnpm --filter @workspace/insights-crawler exec tsx src/crawl.ts --slug=summer-of-copilot-endless-summer --force
```

### Force a full re-crawl

```bash
pnpm --filter @workspace/insights-crawler exec tsx src/crawl.ts --force
```

`--force` ignores both the on-disk HTML cache and the existing `posts.json`,
and re-downloads images.

## Inspecting the report

After a crawl, open `output/report.md`. It lists totals, status counts, and a
per-post row showing image count, byte total, and any notes (missing hero,
inline image failure, "post body not found in SSR'd HTML", etc). Anything that
shows up as `partial` or `failed` should be spot-checked manually before the
downstream ingest step relies on it.

## Politeness

- Sequential request throttle of ~300ms between HTTP calls.
- Concurrency cap of 4 in-flight post extractions.
- Identifies itself with a descriptive `User-Agent`:
  `SynozurInsightsMigrator/1.0`.
- Uses only the public website (no Wix API keys, no auth).

## Out of scope (handled elsewhere)

- Writing posts into the application database.
- Updating any UI under `/insights`.
- Backfilling comments, likes, view counts.
- Migrating non-blog Wix content (events, gallery, etc).
