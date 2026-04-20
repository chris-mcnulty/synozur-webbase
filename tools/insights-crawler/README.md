# Insights Crawler

A standalone, build-time crawler that mirrors the public Wix-hosted blog at
`https://www.synozur.com/insights` into a typed JSON dataset that downstream
tasks (e.g. the public reading experience + DB ingest) can consume without
re-crawling.

This tool is intentionally scoped to **data acquisition only** — it does not
write to the application database, it does not touch the live site's UI, and
it does not run on the production server.

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
- `output/.cache/<slug>.html` — raw HTML cache so re-runs are cheap; deleted
  whenever you want a clean re-fetch.

## How to run

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
